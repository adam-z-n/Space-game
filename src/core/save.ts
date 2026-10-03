import type { ContentPack } from "../content/schema";
import { hashString } from "./rng";
import { Game } from "./game";
import type { Command } from "./commands";
import { STATE_VERSION, type GameState } from "./state";
import { updateSightings } from "./vision";
import { newColony, refreshEmpireStats } from "./economy";

export const SAVE_FORMAT = 1;

/**
 * A save holds both the current state (for instant resume) and the command log
 * (for replays, debugging, and verifying determinism).
 */
export interface SaveGame {
  format: number;
  contentPack: { id: string; version: string };
  turn: number;
  state: GameState;
  log: Command[];
}

export function toSave(game: Game): SaveGame {
  return {
    format: SAVE_FORMAT,
    contentPack: { ...game.state.contentPack },
    turn: game.state.turn,
    state: game.state,
    log: [...game.log],
  };
}

export function serializeSave(game: Game): string {
  return JSON.stringify(toSave(game));
}

export function deserializeSave(json: string, pack: ContentPack): Game {
  const save = JSON.parse(json) as Partial<SaveGame>;
  if (save.format !== SAVE_FORMAT) throw new Error(`unsupported save format ${String(save.format)}`);
  if (!save.state || !Array.isArray(save.log)) throw new Error("corrupt save");
  if (save.contentPack?.id !== pack.id) throw new Error(`save needs content pack "${save.contentPack?.id}"`);
  const state = migrateState(save.state, pack);
  return new Game(pack, state, save.log);
}

/**
 * Bring an older saved state up to STATE_VERSION. Saved command logs stay
 * valid because commands only ever gain new types.
 */
export function migrateState(state: GameState, pack: ContentPack): GameState {
  // Older states don't match today's types; migrate them as plain JSON.
  const old = state as unknown as { version: number; empires: Record<string, unknown>[]; fleets: Record<string, unknown>[]; colonies?: unknown[] };

  if (old.version === 1) {
    // v2 added fog of war (sensor ranges, sightings) and fleet hold orders. v3 recomputes sensors.
    for (const empire of old.empires) empire.sightings = [];
    for (const fleet of old.fleets) fleet.holding = false;
    old.version = 2;
  }

  if (old.version === 2) {
    // v3 adds colonies, the economy and research, and ties fleets to ship templates.
    const migrated = old as unknown as GameState;
    migrated.colonies = [];
    for (const empire of old.empires) {
      delete empire.homeSensorRange;
      Object.assign(empire, {
        colonySightings: [],
        credits: pack.economy.startingCredits,
        food: pack.economy.startingFood,
        techs: [],
        research: { current: null, progress: 0 },
        shipsBuilt: {},
        capitalSensorRange: 0,
        colonySensorRange: 0,
      });
    }
    const legacyTemplates: Record<string, string> = { "Scout Wing": "scout", "Home Fleet": "frigate" };
    for (const fleet of old.fleets) fleet.templateId = legacyTemplates[fleet.name as string] ?? pack.shipTemplates[0]!.id;
    for (const empire of migrated.empires) {
      const home = migrated.galaxy.systems[empire.homeSystemId]!;
      const capital = newColony(migrated, empire, home.id, home.bodies[0]!.id, pack.economy.capitalPopulation, true);
      capital.buildings = [...pack.start.capitalBuildings];
      migrated.colonies.push(capital);
      refreshEmpireStats(migrated, pack, empire);
    }
    old.version = 3;
    updateSightings(migrated, null, migrated.turn);
  }

  if (state.version !== STATE_VERSION) throw new Error(`unsupported state version ${state.version}`);
  return state;
}

/** Stable fingerprint of a state, for determinism checks. */
export function stateHash(state: GameState): string {
  return hashString(JSON.stringify(state)).toString(16).padStart(8, "0");
}

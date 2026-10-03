import type { ContentPack } from "../content/schema";
import { hashString } from "./rng";
import { Game } from "./game";
import type { Command } from "./commands";
import { STATE_VERSION, type Fleet, type GameState } from "./state";
import { updateSightings } from "./vision";
import { empireEffects, newColony, refreshEmpireStats } from "./economy";
import { defaultOrders, designStats, fleetArmed, fleetMaxSupply, startingDesigns } from "./ships";

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
  const migrated = old as unknown as GameState;
  const startVersion = old.version;

  if (old.version === 1) {
    // v2 added fog of war (sightings) and fleet hold orders.
    for (const empire of old.empires) empire.sightings = [];
    for (const fleet of old.fleets) fleet.holding = false;
    old.version = 2;
  }

  if (old.version === 2) {
    // v3 added colonies, the economy and research, and tied fleets to ship templates.
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
    for (const fleet of old.fleets) fleet.templateId = legacyTemplates[fleet.name as string] ?? "frigate";
    for (const empire of migrated.empires) {
      const home = migrated.galaxy.systems[empire.homeSystemId]!;
      const capital = newColony(migrated, empire, home.id, home.bodies[0]!.id, pack.economy.capitalPopulation, true);
      capital.buildings = [...pack.start.capitalBuildings];
      migrated.colonies.push(capital);
    }
    old.version = 3;
  }

  if (old.version === 3) {
    // v4 replaced ship templates with designs and multi-ship fleets, and added supply and combat.
    for (const empire of migrated.empires) empire.designs = startingDesigns(pack);
    for (const colony of migrated.colonies) colony.blockaded = false;
    migrated.lastBattles = [];
    for (const raw of old.fleets) {
      const fleet = raw as unknown as Fleet & { templateId?: string };
      const empire = migrated.empires[fleet.empireId]!;
      const designId = empire.designs.some((d) => d.id === fleet.templateId) ? fleet.templateId! : "frigate";
      delete fleet.templateId;
      const maxHp = designStats(pack, empire.designs.find((d) => d.id === designId)!, empireEffects(pack, empire)).maxHp;
      fleet.ships = [{ id: migrated.nextId++, designId, hp: maxHp }];
      fleet.orders = defaultOrders(fleetArmed(pack, migrated, fleet));
      fleet.supply = fleetMaxSupply(pack, migrated, fleet);
    }
    old.version = 4;
  }

  if (old.version === 4) {
    // v5 added AI personalities and difficulty, and game outcomes.
    const personalities = pack.aiPersonalities.map((p) => p.id);
    for (const empire of migrated.empires) {
      empire.personality = empire.isAI ? personalities[empire.id % personalities.length]! : null;
      empire.difficulty = empire.isAI ? "normal" : null;
    }
    migrated.outcome = null;
    old.version = 5;
  }

  if (old.version === 5) {
    // v6 added colony defenses, troops, invasion orders, minefields and new starting designs.
    for (const colony of migrated.colonies) {
      colony.defenseHp = 0; // refills from buildings over the next turns
      colony.troops = 0;
    }
    for (const fleet of migrated.fleets) fleet.invadeColonyId = null;
    for (const empire of migrated.empires) {
      for (const sighting of empire.colonySightings) {
        sighting.defenseHp = 0;
        sighting.troops = 0;
      }
      for (const design of startingDesigns(pack)) if (!empire.designs.some((d) => d.id === design.id)) empire.designs.push(design);
    }
    migrated.minefields = [];
    old.version = 6;
  }

  if (startVersion !== migrated.version) {
    for (const empire of migrated.empires) refreshEmpireStats(migrated, pack, empire);
    updateSightings(migrated, pack, null, migrated.turn);
  }
  if (migrated.version !== STATE_VERSION) throw new Error(`unsupported state version ${migrated.version}`);
  return migrated;
}

/** Stable fingerprint of a state, for determinism checks. */
export function stateHash(state: GameState): string {
  return hashString(JSON.stringify(state)).toString(16).padStart(8, "0");
}

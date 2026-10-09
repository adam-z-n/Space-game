import type { ContentPack } from "../content/schema";
import { generateGalaxy, installHomeworld, pickHomeSystems } from "./galaxy";
import { Rng } from "./rng";
import { updateSightings } from "./vision";
import { newColony } from "./economy";
import { colonyDefense } from "./defense";
import { newFleet, startingDesigns } from "./ships";
import { STATE_VERSION, type Empire, type GameSettings, type GameState } from "./state";

export const MIN_AI = 2;
export const MAX_AI = 5;

export function validateSettings(settings: GameSettings, pack: ContentPack): string | null {
  if (!settings.seed) return "seed is required";
  if (!pack.galaxySizes.some((g) => g.id === settings.galaxySize)) return `unknown galaxy size "${settings.galaxySize}"`;
  if (!Number.isInteger(settings.aiCount) || settings.aiCount < MIN_AI || settings.aiCount > MAX_AI) {
    return `AI count must be ${MIN_AI}-${MAX_AI}`;
  }
  if (settings.aiCount + 1 > pack.empires.length) return "content pack has too few empires";
  if (settings.playerEmpire !== undefined && !(Number.isInteger(settings.playerEmpire) && settings.playerEmpire >= 0 && settings.playerEmpire < pack.empires.length)) {
    return "unknown player empire";
  }
  if (settings.difficulty !== undefined && !pack.difficulties.some((d) => d.id === settings.difficulty)) return `unknown difficulty "${settings.difficulty}"`;
  if (settings.victory !== undefined && !pack.victory.modes.some((m) => m.id === settings.victory)) return `unknown victory condition "${settings.victory}"`;
  if (settings.turnLimit !== undefined && (!Number.isInteger(settings.turnLimit) || settings.turnLimit < 10)) return "turn limit must be at least 10";
  return null;
}

/** Build the starting state. Same settings + same pack = identical state, on any device. */
export function createInitialState(settings: GameSettings, pack: ContentPack): GameState {
  const error = validateSettings(settings, pack);
  if (error) throw new Error(error);

  const rng = Rng.fromSeed(settings.seed);
  const generated = generateGalaxy(rng.fork("galaxy"), pack, settings.galaxySize, 1);
  const galaxy = generated.galaxy;
  let nextId = generated.nextId;

  const empireCount = settings.aiCount + 1;
  const homes = pickHomeSystems(rng.fork("homes"), galaxy, empireCount);
  // The player takes the chosen empire (the pack's first by default); AIs draw from the rest.
  const playerIndex = settings.playerEmpire ?? 0;
  const playerTemplate = pack.empires[playerIndex]!;
  const others = pack.empires.filter((_, i) => i !== playerIndex);
  const templates = [playerTemplate, ...rng.fork("empires").shuffle(others)];

  // AI temperaments are dealt from a shuffled deck so a game rarely repeats one.
  const personalities = rng.fork("personalities").shuffle(pack.aiPersonalities.map((p) => p.id));
  const difficulty = settings.difficulty ?? "normal";
  const empires: Empire[] = [];
  const homeworldIds: number[] = [];
  for (let i = 0; i < empireCount; i++) {
    const home = homes[i]!;
    homeworldIds.push(nextId);
    installHomeworld(galaxy.systems[home]!, pack, nextId++);
    empires.push({
      id: i,
      name: templates[i]!.name,
      color: templates[i]!.color,
      species: templates[i]!.species,
      isAI: i !== 0 || settings.allAI === true,
      personality: i !== 0 || settings.allAI === true ? personalities[i % personalities.length]! : null,
      // Empire 0 never gets difficulty modifiers, even when the AI plays it: in batch runs it is the
      // stand-in for a human, so its win rate measures how hard each difficulty is.
      difficulty: i !== 0 ? difficulty : null,
      homeSystemId: home,
      explored: [home],
      charted: [home],
      capitalSensorRange: pack.economy.capitalSensorRange,
      colonySensorRange: pack.economy.colonySensorRange,
      sightings: [],
      colonySightings: [],
      credits: pack.economy.startingCredits,
      food: pack.economy.startingFood,
      foodReserve: pack.economy.foodStockCap,
      taxLevel: "normal",
      techs: [],
      schools: [],
      research: { current: null, progress: 0 },
      shipsBuilt: {},
      designs: startingDesigns(pack),
      eliminated: false,
    });
  }

  const state: GameState = {
    version: STATE_VERSION,
    contentPack: { id: pack.id, version: pack.version },
    settings: { ...settings },
    turn: 1,
    rngState: rng.fork("turns").state,
    galaxy,
    empires,
    fleets: [],
    colonies: [],
    nextId,
    lastTurnEvents: [],
    lastBattles: [],
    outcome: null,
    minefields: [],
    outposts: [],
  };

  for (const empire of empires) {
    const capital = newColony(state, empire, empire.homeSystemId, homeworldIds[empire.id]!, pack.economy.capitalPopulation, true);
    capital.buildings = [...pack.start.capitalBuildings];
    const defense = colonyDefense(pack, empire, capital);
    capital.defenseHp = defense.maxHp;
    capital.troops = defense.maxTroops;
    state.colonies.push(capital);
    for (const start of pack.start.fleets) state.fleets.push(newFleet(state, pack, empire, start.ships, empire.homeSystemId));
  }
  updateSightings(state, pack, null, state.turn);
  return state;
}

import type { ContentPack } from "../content/schema";
import { generateGalaxy, installHomeworld, pickHomeSystems } from "./galaxy";
import { Rng } from "./rng";
import { updateSightings } from "./vision";
import { newColony } from "./economy";
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
  // The player keeps the pack's first empire; AIs draw from the rest.
  const [playerTemplate, ...others] = pack.empires;
  const templates = [playerTemplate!, ...rng.fork("empires").shuffle(others)];

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
      isAI: i !== 0 || settings.allAI === true,
      homeSystemId: home,
      explored: [home],
      capitalSensorRange: pack.economy.capitalSensorRange,
      colonySensorRange: pack.economy.colonySensorRange,
      sightings: [],
      colonySightings: [],
      credits: pack.economy.startingCredits,
      food: pack.economy.startingFood,
      techs: [],
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
  };

  for (const empire of empires) {
    const capital = newColony(state, empire, empire.homeSystemId, homeworldIds[empire.id]!, pack.economy.capitalPopulation, true);
    capital.buildings = [...pack.start.capitalBuildings];
    state.colonies.push(capital);
    for (const start of pack.start.fleets) state.fleets.push(newFleet(state, pack, empire, start.ships, empire.homeSystemId));
  }
  updateSightings(state, pack, null, state.turn);
  return state;
}

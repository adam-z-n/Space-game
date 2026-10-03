import type { ContentPack } from "../content/schema";
import { generateGalaxy, installHomeworld, pickHomeSystems } from "./galaxy";
import { Rng } from "./rng";
import { STATE_VERSION, type Empire, type Fleet, type GameSettings, type GameState } from "./state";

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
  const fleets: Fleet[] = [];
  for (let i = 0; i < empireCount; i++) {
    const home = homes[i]!;
    installHomeworld(galaxy.systems[home]!, pack, nextId++);
    empires.push({
      id: i,
      name: templates[i]!.name,
      color: templates[i]!.color,
      isAI: i !== 0,
      homeSystemId: home,
      explored: [home],
      eliminated: false,
    });
    for (const template of pack.start.fleets) {
      fleets.push({ id: nextId++, empireId: i, name: template.name, speed: template.speed, systemId: home, route: [], progress: 0 });
    }
  }

  return {
    version: STATE_VERSION,
    contentPack: { id: pack.id, version: pack.version },
    settings: { ...settings },
    turn: 1,
    rngState: rng.fork("turns").state,
    galaxy,
    empires,
    fleets,
    nextId,
    lastTurnEvents: [],
  };
}

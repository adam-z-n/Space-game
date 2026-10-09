import type { ContentPack } from "../content/schema";
import { fleetArmed, fleetCanColonize, fleetStrength } from "./ships";
import type { EmpireId, GameEvent, GameOutcome, GameState } from "./state";

/**
 * How a game ends. An empire wins by holding a dominant share of all population,
 * by being the last one standing, or by having the best score at the turn limit.
 * The victory mode chosen at setup sets the turn limit (if any) and the share needed.
 */

export interface Score {
  total: number;
  population: number;
  colonies: number;
  techs: number;
  /** Strength of warships. */
  military: number;
}

export function empireScore(state: GameState, pack: ContentPack, empireId: EmpireId): Score {
  const w = pack.victory.score;
  const colonies = state.colonies.filter((c) => c.empireId === empireId);
  const population = colonies.reduce((n, c) => n + c.population, 0);
  const techs = state.empires[empireId]!.techs.length;
  const military = state.fleets.filter((f) => f.empireId === empireId && fleetArmed(pack, state, f)).reduce((n, f) => n + fleetStrength(pack, state, f), 0);
  return {
    total: population * w.population + colonies.length * w.colony + techs * w.tech + Math.floor(military / 10) * w.military,
    population,
    colonies: colonies.length,
    techs,
    military,
  };
}

export function victoryMode(state: GameState, pack: ContentPack): ContentPack["victory"]["modes"][number] {
  return pack.victory.modes.find((m) => m.id === state.settings.victory) ?? pack.victory.modes[0]!;
}

/** The last turn of the game, or null when it runs until someone wins. */
export function turnLimit(state: GameState, pack: ContentPack): number | null {
  return state.settings.turnLimit ?? victoryMode(state, pack).turnLimit;
}

/** Share of the galaxy's population each empire holds, in percent (floored). */
export function populationShares(state: GameState): Map<EmpireId, number> {
  const total = state.colonies.reduce((n, c) => n + c.population, 0);
  const shares = new Map<EmpireId, number>();
  for (const empire of state.empires) {
    const mine = state.colonies.filter((c) => c.empireId === empire.id).reduce((n, c) => n + c.population, 0);
    shares.set(empire.id, total > 0 ? Math.floor((mine * 100) / total) : 0);
  }
  return shares;
}

/** Runs at the end of each turn resolution. `turn` is the turn just resolved. */
export function checkVictory(state: GameState, pack: ContentPack, events: GameEvent[], turn: number): void {
  if (state.outcome) return;

  // Elimination: no colonies and no way to found one.
  for (const empire of state.empires) {
    if (empire.eliminated) continue;
    const hasColony = state.colonies.some((c) => c.empireId === empire.id);
    const canSettle = state.fleets.some((f) => f.empireId === empire.id && fleetCanColonize(pack, state, f));
    if (!hasColony && !canSettle) {
      empire.eliminated = true;
      state.fleets = state.fleets.filter((f) => f.empireId !== empire.id);
      for (const other of state.empires) events.push({ type: "empireEliminated", turn, empireId: other.id, eliminatedId: empire.id });
    }
  }

  const alive = state.empires.filter((e) => !e.eliminated);
  let outcome: GameOutcome | null = null;
  if (alive.length === 1) {
    outcome = { winnerId: alive[0]!.id, reason: "elimination", turn };
  } else if (turn >= pack.victory.dominationMinTurn) {
    const shares = populationShares(state);
    const needed = victoryMode(state, pack).dominationPercent;
    const dominant = alive.find((e) => shares.get(e.id)! >= needed);
    if (dominant) outcome = { winnerId: dominant.id, reason: "domination", turn };
  }
  const limit = turnLimit(state, pack);
  if (!outcome && limit !== null && turn >= limit) {
    const best = [...alive].sort((a, b) => empireScore(state, pack, b.id).total - empireScore(state, pack, a.id).total || a.id - b.id)[0]!;
    outcome = { winnerId: best.id, reason: "turnLimit", turn };
  }
  if (outcome) {
    state.outcome = outcome;
    for (const empire of state.empires) events.push({ type: "gameOver", turn, empireId: empire.id, winnerId: outcome.winnerId, reason: outcome.reason });
  }
}

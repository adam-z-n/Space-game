import { availableTechs, colonizeBlocker, prospectiveMaxPop, researchAccess, techCost } from "../economy";
import { colonyOnBody, type EmpireId, type SystemId } from "../state";
import { populationShares, victoryMode } from "../victory";
import { defenseStrength, lean, type AiContext } from "./context";

/**
 * The strategic layer: what the empire is trying to do this turn.
 *   expand  - settle open planets
 *   build   - grow the economy and fleet; nothing urgent
 *   defend  - hostile warships inside our supply zone
 *   attack  - strong enough to hit a rival's colonies
 */
export type Posture = "expand" | "build" | "defend" | "attack";

export interface ColonyTarget {
  systemId: SystemId;
  bodyId: number;
  value: number;
}

export interface Strategy {
  posture: Posture;
  /** Rival we are fighting, if any. */
  warTarget: EmpireId | null;
  /** Strength of hostile warships inside our supply zone. */
  threat: number;
  /** Total warship strength we want. */
  wantedStrength: number;
  colonyTargets: ColonyTarget[];
  /**
   * Endgame drive (games with no turn limit only): go on the offensive whatever our
   * temperament, raiders mass into full fleets, and banked credits go into warships.
   */
  endgame: boolean;
}

/** Turns after which the endgame drive can start, in games with no turn limit. */
export const ENDGAME = { leaderTurn: 250, leaderShare: 50, humansTurn: 300, humansShare: 20, allTurn: 350, reserve: 200, reservePerColony: 20, overkill: 3 };

/**
 * Whether `ctx`'s empire is in its endgame drive: only in games with no turn limit, when
 *   (a) after turn 250 it holds more than half the galaxy's population, or
 *   (b) after turn 300 the human players together hold less than 20% (every AI), or
 *   (c) after turn 350 (every AI).
 */
export function endgameDrive(ctx: AiContext): boolean {
  const { state, pack } = ctx;
  // The victory mode decides (a testing cap on an open-ended game doesn't switch the drive off).
  if (victoryMode(state, pack).turnLimit !== null) return false;
  if (state.turn > ENDGAME.allTurn) return true;
  if (state.turn <= ENDGAME.leaderTurn) return false;
  const shares = populationShares(state);
  if ((shares.get(ctx.id) ?? 0) > ENDGAME.leaderShare) return true;
  if (state.turn <= ENDGAME.humansTurn) return false;
  const humans = state.empires.filter((e) => !e.isAI).reduce((n, e) => n + (shares.get(e.id) ?? 0), 0);
  return humans < ENDGAME.humansShare;
}

export function decideStrategy(ctx: AiContext): Strategy {
  const { state, pack, empire, personality: p } = ctx;

  // Planets we know of and could settle, that no one we know of holds.
  const taken = new Set(ctx.rivalColonies.map((c) => c.bodyId));
  const colonyTargets: ColonyTarget[] = [];
  for (const systemId of empire.explored) {
    for (const body of state.galaxy.systems[systemId]!.bodies) {
      if (taken.has(body.id) || colonizeBlocker(pack, empire, body) !== null) continue;
      if (colonyOnBody(state, body.id)?.empireId === ctx.id) continue;
      colonyTargets.push({ systemId, bodyId: body.id, value: prospectiveMaxPop(pack, empire, body) });
    }
  }

  const threat = ctx.recentEnemies.filter((s) => ctx.supplied.has(s.systemId)).reduce((n, s) => n + s.strength, 0);
  const blockaded = ctx.colonies.some((c) => c.blockaded);

  // War target: the rival whose nearest known colony is closest to our capital; ties go to the weaker one,
  // counting both its fleets and that colony's orbital defenses.
  let warTarget: EmpireId | null = null;
  let targetDefense = 0;
  let best = Infinity;
  if (ctx.capital) {
    const fromCapital = ctx.dist(ctx.capital.systemId);
    for (const colony of ctx.rivalColonies) {
      const defense = defenseStrength(colony.defenseHp);
      const d = fromCapital[colony.systemId]! * 10 + (ctx.rivalStrength.get(colony.empireId) ?? 0) + defense;
      if (d < best) {
        best = d;
        warTarget = colony.empireId;
        targetDefense = defense;
      }
    }
  }
  // What we'd have to beat: the target's fleets plus the defenses of its colony we'd hit first.
  const targetStrength = warTarget === null ? 0 : (ctx.rivalStrength.get(warTarget) ?? 0) + targetDefense;
  const endgame = endgameDrive(ctx);

  // How much fleet we want: scales with empire size, game time, temperament, and danger.
  const base = (ctx.colonies.length * 12 + state.turn) * lean(p.military);
  let wantedStrength = Math.floor(base / 100) + Math.floor((threat * 3) / 2);

  let posture: Posture;
  const nerve = 100 + p.caution * 10; // percent of the target's strength we want before attacking
  // Our colonies' defenses fight alongside our fleets at home.
  if (threat > 0 && (threat * 2 >= ctx.ownStrength + ctx.ownDefense || blockaded)) {
    posture = "defend";
  } else if (endgame && warTarget !== null) {
    // Endgame drive: attack whatever our temperament. Build up to twice what we face, and past
    // that keep turning a healthy treasury into warships (one more at a time) until we field three
    // times the strongest rival's known fleets and colony defenses, which is enough to finish it.
    posture = "attack";
    const banked = ctx.empire.credits > ENDGAME.reserve + ctx.colonies.length * ENDGAME.reservePerColony;
    const rivals = new Set([...ctx.rivalStrength.keys(), ...ctx.rivalColonies.map((c) => c.empireId)]);
    const strongest = Math.max(
      0,
      ...[...rivals].map((id) => (ctx.rivalStrength.get(id) ?? 0) + ctx.rivalColonies.filter((c) => c.empireId === id).reduce((n, c) => n + defenseStrength(c.defenseHp), 0)),
    );
    const plenty = ctx.ownStrength >= strongest * ENDGAME.overkill;
    wantedStrength = Math.max(wantedStrength, targetStrength * 2, banked && !plenty ? ctx.ownStrength + 1 : 0);
  } else if (
    warTarget !== null &&
    p.aggression >= 4 &&
    state.turn >= 25 - p.aggression &&
    ctx.ownStrength * 100 >= targetStrength * nerve &&
    ctx.ownStrength >= 40
  ) {
    posture = "attack";
    wantedStrength = Math.max(wantedStrength, Math.floor((targetStrength * nerve) / 100));
  } else if (colonyTargets.length > 0 && p.expansion >= 4) {
    posture = "expand";
  } else {
    posture = "build";
  }
  if (posture !== "attack" && p.aggression >= 7 && warTarget !== null) {
    // Aggressive temperaments arm up toward their target even before they can strike.
    wantedStrength = Math.max(wantedStrength, Math.floor((targetStrength * nerve) / 100));
  }

  return { posture, warTarget, threat, wantedStrength, colonyTargets, endgame };
}

/** Pick a tech: personality field weights, nudged by what the empire needs right now. */
export function chooseResearch(ctx: AiContext, strategy: Strategy): string | null {
  const { pack, empire, personality: p } = ctx;
  let bestId: string | null = null;
  let bestScore = -1;
  for (const tech of availableTechs(pack, empire)) {
    let weight = (p.researchFields[tech.field] ?? 1) * 10;
    const fx = tech.effects;
    if ((strategy.posture === "defend" || strategy.posture === "attack") && ["weapons", "defense", "engineering"].includes(tech.field)) weight += 10;
    if (strategy.colonyTargets.length < 2 && (fx.minHabitability ?? 0) < 0) weight += 10 + p.expansion;
    if ((fx.industryPercent ?? 0) > 0 || (fx.industry ?? 0) > 0) weight += p.economy;
    if ((fx.researchPercent ?? 0) > 0 || (fx.research ?? 0) > 0) weight += p.research;
    if (ctx.economy.netCredits < 2 && ((fx.creditsPercent ?? 0) > 0 || (fx.credits ?? 0) > 0)) weight += 15;
    // Specialists lean into their affinity field (it also costs less there).
    if (researchAccess(pack, empire).affinity === tech.field) weight += 10;
    const score = Math.floor((weight * 10000) / techCost(pack, empire, tech));
    if (score > bestScore) {
      bestScore = score;
      bestId = tech.id;
    }
  }
  return bestId;
}

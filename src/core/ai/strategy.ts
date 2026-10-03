import { availableTechs, colonizeBlocker, prospectiveMaxPop } from "../economy";
import { colonyOnBody, type EmpireId, type SystemId } from "../state";
import { lean, type AiContext } from "./context";

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

  // War target: the rival whose nearest known colony is closest to our capital; ties go to the weaker one.
  let warTarget: EmpireId | null = null;
  let best = Infinity;
  if (ctx.capital) {
    const fromCapital = ctx.dist(ctx.capital.systemId);
    for (const colony of ctx.rivalColonies) {
      const d = fromCapital[colony.systemId]! * 10 + (ctx.rivalStrength.get(colony.empireId) ?? 0);
      if (d < best) {
        best = d;
        warTarget = colony.empireId;
      }
    }
  }
  const targetStrength = warTarget === null ? 0 : (ctx.rivalStrength.get(warTarget) ?? 0);

  // How much fleet we want: scales with empire size, game time, temperament, and danger.
  const base = (ctx.colonies.length * 12 + state.turn) * lean(p.military);
  let wantedStrength = Math.floor(base / 100) + Math.floor((threat * 3) / 2);

  let posture: Posture;
  const nerve = 100 + p.caution * 10; // percent of the target's strength we want before attacking
  if (threat > 0 && (threat * 2 >= ctx.ownStrength || blockaded)) {
    posture = "defend";
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

  return { posture, warTarget, threat, wantedStrength, colonyTargets };
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
    const score = Math.floor((weight * 10000) / tech.cost);
    if (score > bestScore) {
      bestScore = score;
      bestId = tech.id;
    }
  }
  return bestId;
}

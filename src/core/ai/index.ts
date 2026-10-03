import type { ContentPack } from "../../content/schema";
import type { Command } from "../commands";
import type { EmpireId, GameState } from "../state";
import { buildContext } from "./context";
import { planWarship } from "./designs";
import { planOperations } from "./operations";
import { planProduction } from "./production";
import { chooseResearch, decideStrategy } from "./strategy";

/**
 * AI empires. Same commands and rules as the player, no hidden information:
 *   1. context    - what this empire knows (own state + sightings)
 *   2. strategy   - posture, war target, wanted fleet strength, research
 *   3. operations - a job for every fleet
 *   4. production - focus, build queues, debt control, buying
 * Personalities (content data) and difficulty (content effects) shape every step.
 */
export function planAiTurn(state: GameState, pack: ContentPack, empireId: EmpireId): Command[] {
  const ctx = buildContext(state, pack, empireId);
  const strategy = decideStrategy(ctx);

  if (ctx.empire.research.current === null) {
    const tech = chooseResearch(ctx, strategy);
    if (tech) ctx.commands.push({ type: "setResearch", empireId, techId: tech });
  }

  const warship = planWarship(ctx);
  if (warship.create) ctx.commands.push({ type: "createDesign", empireId, design: warship.create });

  planOperations(ctx, strategy);
  // Disbanding (production) must not touch fleets that operations just moved or merged.
  planProduction(ctx, strategy, warship.design?.id ?? null);
  return ctx.commands;
}

export { decideStrategy, type Posture, type Strategy } from "./strategy";
export { buildContext } from "./context";

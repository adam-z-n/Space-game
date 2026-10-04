import type { Command } from "../commands";
import { componentAvailable, designBuildable, designStats, hullAvailable } from "../ships";
import type { ShipDesign } from "../state";
import type { AiContext } from "./context";

/**
 * Keeps one current warship design per empire, shaped by its personality's style:
 *   raider   - the most evasive hull, thrusters or an afterburner, the rest weapons
 *   line     - the biggest hull, 60% weapons (a fighter bay among them when it fits),
 *              a targeting computer, the rest armor and shields
 *   fortress - the biggest hull, 40% weapons, point defense, the rest shields and armor
 */

const PREFIX = { raider: "Striker Mk ", line: "Lancer Mk ", fortress: "Bastion Mk " } as const;

export interface WarshipPlan {
  design: ShipDesign | null;
  create: Extract<Command, { type: "createDesign" }>["design"] | null;
}

export function planWarship(ctx: AiContext): WarshipPlan {
  const { pack, empire, personality } = ctx;
  const style = personality.designStyle;
  const hulls = pack.hulls.filter((h) => hullAvailable(pack, empire, h.id) && h.slots >= 2);
  const parts = pack.components.filter((c) => componentAvailable(pack, empire, c.id));
  const punch = (c: (typeof parts)[number]) => c.damage * c.accuracy * c.shots;
  const weapon = parts.filter((c) => c.kind === "weapon").sort((a, b) => punch(b) - punch(a) || a.id.localeCompare(b.id))[0];
  const armor = parts.filter((c) => c.kind === "armor").sort((a, b) => b.hp - a.hp || a.id.localeCompare(b.id))[0];
  const shield = parts.filter((c) => c.kind === "shield").sort((a, b) => b.shield - a.shield || a.id.localeCompare(b.id))[0];
  const engine = parts.filter((c) => c.kind === "engine").sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id))[0];
  const fallback = currentWarship(ctx);
  if (!weapon || hulls.length === 0) return { design: fallback, create: null };

  const hull =
    style === "raider"
      ? [...hulls].sort((a, b) => b.evasion * b.slots - a.evasion * a.slots || b.speed - a.speed || a.id.localeCompare(b.id))[0]!
      : [...hulls].sort((a, b) => b.slots - a.slots || b.structure - a.structure || a.id.localeCompare(b.id))[0]!;

  const fits = (c: (typeof parts)[number]) => hull.slots >= c.minSlots;
  const thrusters = parts.find((c) => c.maneuver > 0);
  const hangar = parts.filter((c) => c.kind === "hangar" && fits(c)).sort((a, b) => punch(b) - punch(a) || a.id.localeCompare(b.id))[0];
  const computer = parts.find((c) => c.accuracyBonus > 0);
  const pointDefense = parts.find((c) => c.pointDefense > 0);
  const components: string[] = [];
  if (style === "raider") {
    const mobility = thrusters ?? engine;
    if (mobility && hull.slots >= 3) components.push(mobility.id);
    while (components.length < hull.slots) components.push(weapon.id);
  } else {
    const weapons = Math.max(1, Math.round((hull.slots * (style === "line" ? 60 : 40)) / 100));
    for (let i = 0; i < weapons; i++) components.push(i === 0 && style === "line" && hangar ? hangar.id : weapon.id);
    if (hull.slots >= 5) {
      const gadget = style === "line" ? computer : pointDefense;
      if (gadget && components.length < hull.slots) components.push(gadget.id);
    }
    let i = 0;
    while (components.length < hull.slots) {
      const preferShield = style === "fortress" ? i % 3 !== 2 : i % 2 === 1;
      components.push(preferShield && shield ? shield.id : (armor?.id ?? weapon.id));
      i++;
    }
  }

  const same = empire.designs.find((d) => !d.obsolete && d.hull === hull.id && d.components.join() === components.join());
  if (same) return { design: same, create: null };

  // Only switch if the new design is meaningfully better per unit of cost.
  if (fallback) {
    const fx = ctx.fx;
    const value = (d: Pick<ShipDesign, "hull" | "components">) => {
      const s = designStats(pack, d, fx);
      return Math.floor((s.damagePerRound * (s.maxHp + s.shield * 6) * 100) / s.cost);
    };
    if (value({ hull: hull.id, components }) * 100 < value(fallback) * 110) return { design: fallback, create: null };
  }
  const mark = empire.designs.filter((d) => d.name.startsWith(PREFIX[style])).length + 1;
  return { design: fallback, create: { name: `${PREFIX[style]}${mark}`, hull: hull.id, components, formation: "front" } };
}

/** The newest buildable warship design, or the best armed starting design. */
export function currentWarship(ctx: AiContext): ShipDesign | null {
  const { pack, empire } = ctx;
  const prefix = PREFIX[ctx.personality.designStyle];
  const own = empire.designs.filter((d) => d.name.startsWith(prefix) && designBuildable(pack, empire, d));
  if (own.length > 0) return own[own.length - 1]!;
  const armed = empire.designs.filter((d) => designBuildable(pack, empire, d) && designStats(pack, d, ctx.fx).armed);
  return armed.sort((a, b) => designStats(pack, b, ctx.fx).damagePerRound - designStats(pack, a, ctx.fx).damagePerRound || a.id.localeCompare(b.id))[0] ?? null;
}

export function designWhere(ctx: AiContext, test: (s: ReturnType<typeof designStats>) => boolean): ShipDesign | null {
  return ctx.empire.designs.find((d) => designBuildable(ctx.pack, ctx.empire, d) && test(designStats(ctx.pack, d, ctx.fx))) ?? null;
}

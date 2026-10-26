import type { Command } from "../commands";
import { componentAvailable, componentFits, designBuildable, designStats, hullAvailable, hullSlots, slotsUsed } from "../ships";
import type { ContentPack } from "../../content/schema";
import type { ShipDesign } from "../state";
import { hasFlag } from "../economy";
import type { AiContext } from "./context";

/**
 * Keeps one current warship design per empire, shaped by its personality's style:
 *   raider   - the most evasive hull, thrusters or an afterburner, the rest weapons
 *   line     - the biggest hull, 60% weapons (a fighter bay among them when it fits, and support guns:
 *              ion cannons, a graviton lance for warlike temperaments, a singularity charge on big hulls),
 *              a targeting computer, the rest armor and shields
 *   fortress - the biggest hull, 40% weapons (an EMP torpedo among them), point defense or flak, the rest
 *              shields and armor
 * Weapons are chosen by `weaponValue`, which counts what specials do.
 */

const PREFIX = { raider: "Striker Mk ", line: "Lancer Mk ", fortress: "Bastion Mk " } as const;

export interface WarshipPlan {
  design: ShipDesign | null;
  create: Extract<Command, { type: "createDesign" }>["design"] | null;
}

type Part = ContentPack["components"][number];

/**
 * What a weapon is worth per slot against a typical enemy ship, whose shields we take to be twice our own
 * best shield (the AI only knows its own tech). Pierce and nanite weapons ignore shields (nanites hit four
 * rounds running); area weapons hit about four ships; missiles and torpedoes lose a little for running out.
 * Ion cannons, graviton lances and EMP torpedoes are support guns, valued for what they do to the enemy.
 */
export function weaponValue(part: Part, enemyShield: number, style: "raider" | "line" | "fortress"): number {
  const hit = part.accuracy * part.shots;
  let value: number;
  switch (part.special) {
    case "pierce":
      value = part.damage * hit;
      break;
    case "nanite":
      value = part.damage * 4 * hit;
      break;
    case "ion":
      // Each hit strips shields for the rest of the battle: worth it to the guns that follow (about three shots).
      value = Math.min(part.damage, enemyShield) * 3 * hit;
      break;
    case "emp":
      // Each hit knocks out a part until repaired: worth about a hit's damage twice over.
      value = Math.max(1, part.damage - enemyShield) * hit + 12 * part.accuracy;
      break;
    case "pin":
      // Holds the enemy fleet in battle: half as much again for warlike temperaments that want the kill.
      value = Math.floor((Math.max(1, part.damage - enemyShield) * hit * 3) / 2);
      break;
    default:
      value = Math.max(1, part.damage - enemyShield) * hit;
  }
  if (part.special === "area") value *= 4;
  // Raiders hunt transports and support ships: phase torpedoes go straight for them.
  if (part.special === "phase" && style === "raider") value = Math.floor((value * 3) / 2);
  if (part.ammo > 0) value = Math.floor((value * 9) / 10);
  return Math.floor(value / Math.max(1, part.size));
}

export function planWarship(ctx: AiContext): WarshipPlan {
  const { pack, empire, personality } = ctx;
  const style = personality.designStyle;
  const hulls = pack.hulls.filter((h) => hullAvailable(pack, empire, h.id) && h.slots >= 2);
  const parts = pack.components.filter((c) => componentAvailable(pack, empire, c.id));
  const armor = parts.filter((c) => c.kind === "armor").sort((a, b) => b.hp - a.hp || a.id.localeCompare(b.id))[0];
  const shield = parts.filter((c) => c.kind === "shield").sort((a, b) => b.shield - a.shield || a.id.localeCompare(b.id))[0];
  const engine = parts.filter((c) => c.kind === "engine").sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id))[0];
  const enemyShield = (shield?.shield ?? 0) * 2;
  const fallback = currentWarship(ctx);
  if (hulls.length === 0) return { design: fallback, create: null };

  const hull =
    style === "raider"
      ? [...hulls].sort((a, b) => b.evasion * b.slots - a.evasion * a.slots || b.speed - a.speed || a.id.localeCompare(b.id))[0]!
      : [...hulls].sort((a, b) => b.slots - a.slots || b.structure - a.structure || a.id.localeCompare(b.id))[0]!;

  const slots = hullSlots(pack, empire, hull.id);
  const fits = (c: Part) => componentFits(pack, empire, hull.id, c.id) && c.size <= slots;
  const support = new Set(["ion", "emp", "pin"]);
  const value = (c: Part) => weaponValue(c, enemyShield, style);
  // Main gun: the best value per slot among the weapons that fit (support guns aside).
  const weapon = parts
    .filter((c) => c.kind === "weapon" && fits(c) && !support.has(c.special ?? "") && c.special !== "area")
    .sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id))[0];
  if (!weapon) return { design: fallback, create: null };
  const special = (kind: string) => parts.filter((c) => c.special === kind && fits(c)).sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id))[0];
  const thrusters = parts.find((c) => c.maneuver > 0);
  const hangar = parts.filter((c) => c.kind === "hangar" && fits(c)).sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id))[0];
  const computer = parts.find((c) => c.accuracyBonus > 0);
  const flak = parts.filter((c) => c.kind === "weapon" && c.pointDefense > 0 && fits(c)).sort((a, b) => b.pointDefense - a.pointDefense || a.id.localeCompare(b.id))[0];
  const pointDefense = flak ?? parts.find((c) => c.pointDefense > 0);
  const commandNet = parts.find((c) => c.command > 0 && fits(c));
  const components: string[] = [];
  const used = () => slotsUsed(pack, components);
  const add = (c: Part | undefined) => {
    if (c && used() + c.size <= slots) components.push(c.id);
  };
  if (style === "raider") {
    const mobility = thrusters ?? engine;
    if (mobility && slots >= 3) add(mobility);
    while (used() + weapon.size <= slots) components.push(weapon.id);
  } else {
    const gunSlots = Math.max(1, Math.round((slots * (style === "line" ? 60 : 40)) / 100));
    // Support guns take some of the gun slots: an ion cannon per 5 slots (line, against shields), a graviton
    // lance for warlike temperaments, a singularity charge on big hulls (line), an EMP torpedo (fortress).
    const extras: Part[] = [];
    if (style === "line") {
      const ion = special("ion");
      if (ion && enemyShield > 0 && weapon.special !== "pierce" && weapon.special !== "nanite") for (let i = 0; i < Math.floor(slots / 5); i++) extras.push(ion);
      const lance = special("pin");
      if (lance && personality.aggression >= 7) extras.push(lance);
      const area = special("area");
      if (area && slots >= 8) extras.push(area);
    } else {
      const emp = special("emp");
      if (emp) extras.push(emp);
    }
    if (style === "line" && hangar) add(hangar);
    for (const extra of extras) if (used() + extra.size < gunSlots) add(extra);
    while (used() + weapon.size <= Math.max(gunSlots, weapon.size) && used() + weapon.size <= slots) components.push(weapon.id);
    if (slots >= 5) add(style === "line" ? computer : pointDefense);
    add(commandNet);
    let i = 0;
    while (used() < slots) {
      const preferShield = style === "fortress" ? i % 3 !== 2 : i % 2 === 1;
      const filler = preferShield && shield ? shield : (armor ?? weapon);
      if (used() + filler.size > slots) break;
      components.push(filler.id);
      i++;
    }
  }

  const same = empire.designs.find((d) => !d.obsolete && d.formation !== "screen" && d.hull === hull.id && d.components.join() === components.join());
  if (same) return { design: same, create: null };

  // Only switch if the new design is meaningfully better per unit of cost.
  if (fallback) {
    const fx = ctx.fx;
    const worth = (d: Pick<ShipDesign, "hull" | "components">) => {
      const s = designStats(pack, d, fx);
      const guns = d.components.reduce((n, id) => {
        const c = pack.components.find((x) => x.id === id)!;
        return n + (c.kind === "weapon" || c.kind === "hangar" ? value(c) * Math.max(1, c.size) : 0);
      }, 0);
      return Math.floor((guns * (s.maxHp + s.shield * 6)) / Math.max(1, s.cost));
    };
    if (worth({ hull: hull.id, components }) * 100 < worth(fallback) * 110) return { design: fallback, create: null };
  }
  const mark = empire.designs.filter((d) => d.name.startsWith(PREFIX[style])).length + 1;
  return { design: fallback, create: { name: `${PREFIX[style]}${mark}`, hull: hull.id, components, formation: "front" } };
}

/** The newest buildable warship design, or the best armed starting design. */
export function currentWarship(ctx: AiContext): ShipDesign | null {
  const { pack, empire } = ctx;
  const prefix = PREFIX[ctx.personality.designStyle];
  // Guard twins (screen formation) are built alongside, not as the main warship.
  const own = empire.designs.filter((d) => d.name.startsWith(prefix) && d.formation !== "screen" && designBuildable(pack, empire, d));
  if (own.length > 0) return own[own.length - 1]!;
  const armed = empire.designs.filter((d) => designBuildable(pack, empire, d) && designStats(pack, d, ctx.fx).armed);
  return armed.sort((a, b) => designStats(pack, b, ctx.fx).damagePerRound - designStats(pack, a, ctx.fx).damagePerRound || a.id.localeCompare(b.id))[0] ?? null;
}

/**
 * Once flagship targeting is known (the AI assumes rivals will learn it as it did), a Guard twin of the main
 * warship in the Screen formation, to take shots aimed at the flagship. Null if not needed or already designed.
 */
export function planGuard(ctx: AiContext, warship: ShipDesign | null): Extract<Command, { type: "createDesign" }>["design"] | null {
  if (!warship || !hasFlag(ctx.pack, ctx.empire, "flagshipTargeting")) return null;
  if (guardFor(ctx, warship)) return null;
  return { name: `${warship.name} Guard`, hull: warship.hull, components: [...warship.components], formation: "screen" };
}

export function guardFor(ctx: AiContext, warship: ShipDesign): ShipDesign | null {
  return ctx.empire.designs.find((d) => !d.obsolete && d.formation === "screen" && d.hull === warship.hull && d.components.join() === warship.components.join()) ?? null;
}

export function designWhere(ctx: AiContext, test: (s: ReturnType<typeof designStats>) => boolean): ShipDesign | null {
  return ctx.empire.designs.find((d) => designBuildable(ctx.pack, ctx.empire, d) && test(designStats(ctx.pack, d, ctx.fx))) ?? null;
}

/**
 * A siege ship for strike forces once bomb bays (or, for the endgame, plague bombs) are researched: the biggest hull that takes them,
 * 40% bomb bays, a weapon or two to count as a warship, the rest armor. Null when we have one already.
 */
export function planBomber(ctx: AiContext, plague = false): Extract<Command, { type: "createDesign" }>["design"] | null {
  const { pack, empire } = ctx;
  if (designWhere(ctx, (s) => s.bombard > 0 && s.armed && !s.cracker && s.plague > 0 === plague)) return null;
  const bomb = pack.components.find((c) => c.bombard > 0 && !c.cracker && c.plague === plague && componentAvailable(pack, empire, c.id));
  const current = currentWarship(ctx);
  if (!bomb || !current) return null;
  const hull = pack.hulls
    .filter((h) => hullAvailable(pack, empire, h.id) && componentFits(pack, empire, h.id, bomb.id))
    .sort((a, b) => b.slots - a.slots || b.structure - a.structure || a.id.localeCompare(b.id))[0];
  if (!hull) return null;
  const slots = hullSlots(pack, empire, hull.id);
  const weapon = current.components.find((id) => pack.components.find((c) => c.id === id)?.kind === "weapon" && componentFits(pack, empire, hull.id, id));
  const armor = pack.components.filter((c) => c.kind === "armor" && componentAvailable(pack, empire, c.id)).sort((a, b) => b.hp - a.hp || a.id.localeCompare(b.id))[0];
  if (!weapon) return null;
  const bombs = Math.max(1, Math.round((slots * 40) / 100));
  const components = [...Array.from({ length: bombs }, () => bomb.id), weapon];
  if (slots - components.length >= 3) components.push(weapon);
  while (components.length < slots) components.push(armor?.id ?? weapon);
  return { name: plague ? "Blight Mk 1" : "Siege Mk 1", hull: hull.id, components, formation: "front" };
}

/** Raiders and warlike temperaments that know cloaking raid in cloaked packs. */
export function raidsCloaked(ctx: AiContext): boolean {
  return ctx.personality.designStyle === "raider" || ctx.personality.aggression >= 7;
}

/** The cloaked raider in use: armed and cloaked. */
export function shadeDesign(ctx: AiContext): ShipDesign | null {
  return designWhere(ctx, (s) => s.stealth && s.armed);
}

/**
 * A cloaked raider (once cloaking is known, for temperaments that raid): the biggest hull a Cloaking Device fits,
 * the device, and the best guns in every other slot. Null when not wanted or already designed.
 */
export function planShade(ctx: AiContext): Extract<Command, { type: "createDesign" }>["design"] | null {
  const { pack, empire } = ctx;
  if (!raidsCloaked(ctx) || shadeDesign(ctx)) return null;
  const cloak = pack.components.find((c) => c.stealth > 0 && componentAvailable(pack, empire, c.id));
  if (!cloak) return null;
  const hull = pack.hulls
    .filter((h) => hullAvailable(pack, empire, h.id) && componentFits(pack, empire, h.id, cloak.id) && h.slots >= 2)
    .sort((a, b) => b.slots - a.slots || b.evasion - a.evasion || a.id.localeCompare(b.id))[0];
  if (!hull) return null;
  const shield = pack.components.filter((c) => c.kind === "shield" && componentAvailable(pack, empire, c.id)).sort((a, b) => b.shield - a.shield)[0];
  const enemyShield = (shield?.shield ?? 0) * 2;
  const weapon = pack.components
    .filter((c) => c.kind === "weapon" && componentAvailable(pack, empire, c.id) && componentFits(pack, empire, hull.id, c.id) && c.size === 1 && !["ion", "emp", "pin"].includes(c.special ?? ""))
    .sort((a, b) => weaponValue(b, enemyShield, "raider") - weaponValue(a, enemyShield, "raider") || a.id.localeCompare(b.id))[0];
  if (!weapon) return null;
  const slots = hullSlots(pack, empire, hull.id);
  const components = [cloak.id, ...Array.from({ length: Math.max(1, slots - cloak.size) }, () => weapon.id)];
  const mark = empire.designs.filter((d) => d.name.startsWith("Shade Mk ")).length + 1;
  return { name: `Shade Mk ${mark}`, hull: hull.id, components, formation: "front" };
}

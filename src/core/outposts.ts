import type { ContentPack } from "../content/schema";
import { empireEffects, hasFlag } from "./economy";
import { fleetArmed } from "./ships";
import type { ColonyDefense } from "./defense";
import type { Body, Empire, EmpireId, GameEvent, GameState, Outpost, OutpostKind, SystemId } from "./state";

/**
 * Outposts: stations on asteroid fields and gas giants, built by ships with an
 * outpost kit. Combat outposts carry guns and sensors, fight like a colony's
 * defenses and hold chokepoints; they can be upgraded to supply depots that
 * supply and repair fleets. Mining outposts earn credits but can't defend
 * themselves: any armed enemy fleet in their system destroys them.
 */

export function outpostTechOk(pack: ContentPack, empire: Empire, kind: OutpostKind | "depot"): boolean {
  const req = pack.outposts[kind].requires;
  return !req || empire.techs.includes(req);
}

/** Why `empire` can't put a `kind` outpost on `body` at all (research, or the wrong kind of body), or null. */
function outpostKindBlocker(pack: ContentPack, empire: Empire, body: Body, kind: OutpostKind): string | null {
  const config = pack.outposts[kind];
  if (!outpostTechOk(pack, empire, kind)) return `${config.name} needs research`;
  const gas = kind === "mining" && body.kind === "gasGiant" && hasFlag(pack, empire, "gasMining");
  if (!config.bodies.includes(body.kind) && !gas) return `a ${config.name} can't be built on that`;
  return null;
}

/** Why `empire` can't build a `kind` outpost on `body`, or null. */
export function outpostBlocker(state: GameState, pack: ContentPack, empire: Empire, body: Body, kind: OutpostKind): string | null {
  const blocker = outpostKindBlocker(pack, empire, body, kind);
  if (blocker) return blocker;
  if (state.outposts.some((o) => o.bodyId === body.id)) return "there is already an outpost there";
  if (state.colonies.some((c) => c.bodyId === body.id)) return "a colony is there";
  return null;
}

/**
 * Building with an outpost ship on a body the empire already holds: its own outpost of another kind is
 * converted (marks and depot are lost), and its own gas giant habitat is abandoned (its people are lost).
 * Why it can't, or null. Bodies the empire doesn't hold go through `outpostBlocker`.
 */
export function outpostConversionBlocker(state: GameState, pack: ContentPack, empire: Empire, body: Body, kind: OutpostKind): string | null {
  const outpost = state.outposts.find((o) => o.bodyId === body.id);
  const colony = state.colonies.find((c) => c.bodyId === body.id);
  if (outpost?.empireId === empire.id) {
    if (outpost.kind === kind) return `it is already a ${pack.outposts[kind].name}`;
  } else if (colony?.empireId === empire.id) {
    if (colony.capital) return "you can't abandon your capital";
  } else {
    return outpostBlocker(state, pack, empire, body, kind);
  }
  return outpostKindBlocker(pack, empire, body, kind);
}

/** A combat outpost's guns and hit points, acting in battle like a colony's defenses. */
export function outpostDefense(pack: ContentPack, empire: Empire, outpost: Outpost): ColonyDefense {
  if (outpost.kind !== "combat") return { maxHp: 0, shield: 0, weapons: [], maxTroops: 0, mines: 0, satellites: 0 };
  const pct = 100 + empireEffects(pack, empire).defensePercent;
  // An upgraded outpost uses its mark's hit points and guns in place of the base ones.
  const config = outpost.mark > 0 ? pack.outposts.marks[outpost.mark - 1]! : pack.outposts.combat;
  const weapons = config.weapons.flatMap((w) => Array.from({ length: w.count }, () => ({ damage: Math.floor((w.damage * pct) / 100), accuracy: w.accuracy, range: 3, ammo: 0 })));
  return { maxHp: Math.floor((config.hp * pct) / 100), shield: 0, weapons, maxTroops: 0, mines: 0, satellites: 0 };
}

export function outpostSensorRange(pack: ContentPack, empire: Empire, outpost: Outpost): number {
  return pack.outposts[outpost.kind].sensorRange + empireEffects(pack, empire).sensorRange;
}

export function outpostName(pack: ContentPack, outpost: Outpost): string {
  return outpost.depot ? pack.outposts.depot.name : pack.outposts[outpost.kind].name;
}

/** Credits per turn from mining outposts, and upkeep for all outposts. */
export function outpostFinances(state: GameState, pack: ContentPack, empireId: EmpireId): { income: number; upkeep: number } {
  let income = 0;
  let upkeep = 0;
  for (const o of state.outposts) {
    if (o.empireId !== empireId) continue;
    if (o.kind === "mining") income += Math.floor((pack.outposts.mining.credits * (100 + empireEffects(pack, state.empires[empireId]!).miningPercent)) / 100);
    const base = o.mark > 0 ? pack.outposts.marks[o.mark - 1]!.upkeep : pack.outposts[o.kind].upkeep;
    upkeep += base + (o.depot ? pack.outposts.depot.upkeep : 0);
  }
  return { income, upkeep };
}

/** Systems where `empireId` has an armed fleet stopped (for raids and sieges). */
function armedPresence(state: GameState, pack: ContentPack): Map<SystemId, Set<EmpireId>> {
  const present = new Map<SystemId, Set<EmpireId>>();
  for (const fleet of state.fleets) {
    if (fleet.progress > 0 || !fleetArmed(pack, state, fleet)) continue;
    present.set(fleet.systemId, (present.get(fleet.systemId) ?? new Set()).add(fleet.empireId));
  }
  return present;
}

/**
 * After combat: outposts knocked to 0 are destroyed, and mining outposts are
 * wrecked by any armed enemy fleet in their system unless an armed friendly
 * fleet or a standing combat outpost of their owner is there too.
 */
export function resolveOutpostRaids(state: GameState, pack: ContentPack, events: GameEvent[]): void {
  const present = armedPresence(state, pack);
  const guarded = (o: Outpost) =>
    present.get(o.systemId)?.has(o.empireId) || state.outposts.some((p) => p.empireId === o.empireId && p.systemId === o.systemId && p.kind === "combat" && p.defenseHp > 0);
  const lost: Outpost[] = [];
  for (const o of state.outposts) {
    const hostile = [...(present.get(o.systemId) ?? [])].some((e) => e !== o.empireId);
    if ((o.kind === "combat" && o.defenseHp <= 0) || (o.kind === "mining" && hostile && !guarded(o))) lost.push(o);
  }
  for (const o of lost) events.push({ type: "outpostLost", turn: state.turn, empireId: o.empireId, systemId: o.systemId, kind: o.kind });
  const gone = new Set(lost.map((o) => o.id));
  state.outposts = state.outposts.filter((o) => !gone.has(o.id));
}

/** Economy phase: combat outposts repair unless enemy warships are in their system. */
export function regenerateOutposts(state: GameState, pack: ContentPack): void {
  const present = armedPresence(state, pack);
  for (const o of state.outposts) {
    if (o.kind !== "combat") continue;
    if ([...(present.get(o.systemId) ?? [])].some((e) => e !== o.empireId)) continue;
    const max = outpostDefense(pack, state.empires[o.empireId]!, o).maxHp;
    o.defenseHp = Math.min(max, o.defenseHp + Math.ceil((max * pack.combat.defenseRepairPercent) / 100));
  }
}

import {
  colonizeBlocker,
  colonyOnBody,
  designStats,
  empireEconomy,
  empireEffects,
  getTech,
  knownAdjacency,
  planetStats,
  prospectiveMaxPop,
  shortestPaths,
  researchAccess,
  schoolBlocker,
  schoolsAllowed,
  techAvailable,
  techCost,
  techUnlocks,
  type Body,
  type ContentPack,
  type Empire,
  type EmpireView,
  type GameState,
  type SystemId,
} from "../core";
import { h, turnsText } from "./dom";
import type { PanelContext } from "./economyPanels";

/**
 * Planning screens: the whole research tree as a reference, and a survey of
 * known planets for choosing where to colonize.
 */

function closeButton(ctx: PanelContext): HTMLButtonElement {
  const b = h("button", { textContent: "✕", ariaLabel: "Close" });
  b.onclick = () => ctx.close();
  return b;
}

/** How many prerequisite steps a tech sits behind (0 for a root tech). */
function techDepth(pack: ContentPack, id: string, memo = new Map<string, number>()): number {
  const known = memo.get(id);
  if (known !== undefined) return known;
  const tech = getTech(pack, id);
  const depth = tech.requires.length === 0 ? 0 : 1 + Math.max(...tech.requires.map((r) => techDepth(pack, r, memo)));
  memo.set(id, depth);
  return depth;
}

/** Everything a tech unlocks, by name. */
export function unlockText(pack: ContentPack, techId: string): string {
  const u = techUnlocks(pack, techId);
  const names = [
    ...u.hulls.map((id) => `${pack.hulls.find((x) => x.id === id)!.name} hull`),
    ...u.components.map((id) => pack.components.find((x) => x.id === id)!.name),
    ...u.buildings.map((id) => pack.buildings.find((x) => x.id === id)!.name),
  ];
  return names.join(", ");
}

export function techTreePanel(ctx: PanelContext): HTMLElement {
  const { game, pack } = ctx;
  const empire = game.state.empires[game.playerId]!;
  const eco = empireEconomy(game.state, pack, game.playerId);
  const memo = new Map<string, number>();
  const done = new Set(empire.techs);
  const access = researchAccess(pack, empire);

  const techRow = (tech: ContentPack["techs"][number]) => {
    const current = empire.research.current === tech.id;
    const available = techAvailable(pack, empire, tech.id);
    const closed = !done.has(tech.id) ? schoolBlocker(pack, empire, tech) : null;
    const state = done.has(tech.id) ? "done" : current ? "current" : available ? "available" : "locked";
    const label = { done: "✓ Researched", current: "Researching", available: "Available", locked: closed ? "Closed" : "Locked" }[state];
    const missing = tech.requires.filter((r) => !done.has(r)).map((r) => getTech(pack, r).name);
    const unlocks = unlockText(pack, tech.id);
    const cost = techCost(pack, empire, tech);
    const turns = eco.research > 0 ? Math.ceil(cost / eco.research) : Infinity;
    const li = h(
      "li",
      { className: `tech ${state}${available ? " tappable" : ""}`, style: `margin-left:${Math.min(techDepth(pack, tech.id, memo), 4) * 12}px` },
      h(
        "span",
        { className: "grow" },
        h("div", { textContent: tech.name }),
        h("div", { className: "muted small", textContent: tech.description }),
        unlocks ? h("div", { className: "small accent-text", textContent: `Unlocks: ${unlocks}` }) : null,
        closed ? h("div", { className: "small warn-text", textContent: closed[0]!.toUpperCase() + closed.slice(1) }) : missing.length ? h("div", { className: "small warn-text", textContent: `Needs ${missing.join(" and ")}` }) : null,
      ),
      h("span", { className: "tech-status" }, h("div", { textContent: label }), h("div", { className: "muted small", textContent: done.has(tech.id) ? "" : `${cost} · ${turnsText(turns)}` })),
    );
    if (available) li.onclick = () => ctx.issue({ type: "setResearch", empireId: game.playerId, techId: tech.id });
    return li;
  };
  const ordered = (list: ContentPack["techs"]) =>
    [...list].sort((a, b) => techDepth(pack, a.id, memo) - techDepth(pack, b.id, memo) || a.cost - b.cost || a.id.localeCompare(b.id));

  const sections: HTMLElement[] = [];
  for (const field of pack.researchFields) {
    const techs = pack.techs.filter((t) => t.field === field.id);
    if (techs.length === 0) continue;
    const researched = techs.filter((t) => done.has(t.id)).length;
    const affinity = access.affinity === field.id ? ` · affinity: ${access.affinityPercent}% faster` : "";
    const allowed = schoolsAllowed(pack, empire, field.id);
    const list = h("ul", { className: "tech-tree" });
    for (const tech of ordered(techs.filter((t) => !t.school))) list.append(techRow(tech));
    const schools = pack.researchSchools.filter((s) => s.field === field.id);
    if (schools.length > 0) {
      const choice = Number.isFinite(allowed) ? `choose ${allowed === 1 ? "one" : "two"} of ${schools.length}` : "all open to you";
      list.append(h("li", { className: "section" }, h("span", { textContent: `Schools (${choice})` })));
      for (const school of schools) {
        const chosen = empire.schools.includes(school.id);
        list.append(h("li", { className: "school-head" }, h("span", { className: "grow" }, h("div", { textContent: `${school.name}${chosen ? " ✓" : ""}` }), h("div", { className: "muted small", textContent: school.description }))));
        for (const tech of ordered(techs.filter((t) => t.school === school.id))) list.append(techRow(tech));
      }
    }
    sections.push(h("h3", { textContent: `${field.name} (${researched}/${techs.length})${affinity}` }), list);
  }

  const species = pack.species.find((s) => s.id === empire.species);
  const rules =
    access.access === "full"
      ? `${species?.name ?? "Your species"} can research every school.`
      : `${species?.name ?? "Your species"} follow one school per field (two in ${pack.researchFields.find((f) => f.id === access.affinity)?.name ?? "their affinity field"}). Your first tech in a school commits you to it and closes the others. Conquest can still capture closed techs.`;
  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, "Research tree", closeButton(ctx)),
    h("div", { className: "muted small", textContent: `${empire.techs.length} of ${pack.techs.length} techs researched. ${rules} Tap an available tech to research it next.` }),
    ...sections,
  );
}

// ---------- colonization planner ----------

export interface PlanetPlan {
  systemId: SystemId;
  systemName: string;
  body: Body;
  /** "Medium Ocean" */
  label: string;
  richness: string;
  habitability: number;
  /** Max population if settled now, or null when research is still needed. */
  maxPop: number | null;
  /** Lane distance from the nearest own colony (Infinity if no known route). */
  distance: number;
}

/** Known, unclaimed planets in explored systems, best first. */
export function planetPlans(state: GameState, pack: ContentPack, view: EmpireView, empire: Empire): PlanetPlan[] {
  const adj = knownAdjacency(state, empire.id);
  const own = state.colonies.filter((c) => c.empireId === empire.id);
  const distance = new Array<number>(state.galaxy.systems.length).fill(Infinity);
  for (const systemId of new Set(own.map((c) => c.systemId))) {
    const { dist } = shortestPaths(adj, systemId);
    dist.forEach((d, i) => (distance[i] = Math.min(distance[i]!, d)));
  }
  const claimed = new Set(view.systems.flatMap((s) => s.colonies.map((c) => c.bodyId)));
  const plans: PlanetPlan[] = [];
  for (const system of view.systems) {
    if (!system.bodies) continue;
    for (const body of system.bodies) {
      if (body.kind !== "planet" || claimed.has(body.id) || colonyOnBody(state, body.id)?.empireId === empire.id) continue;
      const type = pack.planetTypes.find((t) => t.id === body.planetType);
      const size = pack.planetSizes.find((t) => t.id === body.size);
      plans.push({
        systemId: system.id,
        systemName: system.name,
        body,
        label: `${size?.name ?? ""} ${type?.name ?? ""}`.trim(),
        richness: pack.richness.find((r) => r.id === body.richness)?.name ?? "",
        habitability: planetStats(pack, body).habitability,
        maxPop: colonizeBlocker(pack, empire, body) === null ? prospectiveMaxPop(pack, empire, body) : null,
        distance: distance[system.id]!,
      });
    }
  }
  return plans.sort((a, b) => (b.maxPop ?? -1) - (a.maxPop ?? -1) || a.distance - b.distance || a.body.id - b.body.id);
}

/** Short map annotation per explored system with free planets: the best one's value. */
export function plannerLabels(plans: readonly PlanetPlan[], pack: ContentPack): Map<SystemId, { text: string; color: string }> {
  const labels = new Map<SystemId, { text: string; color: string }>();
  const colors = pack.presentation.surveyColors;
  for (const plan of plans) {
    if (labels.has(plan.systemId)) continue; // plans are sorted best first
    labels.set(
      plan.systemId,
      plan.maxPop !== null ? { text: `pop ${plan.maxPop} · ${plan.richness}`, color: colors.habitable } : { text: `hab ${plan.habitability} · ${plan.richness}`, color: colors.hostile },
    );
  }
  return labels;
}

export function plannerPanel(ctx: PanelContext, view: EmpireView, locate: (systemId: SystemId) => void, showOnMap: boolean, toggleMap: () => void): HTMLElement {
  const { game, pack } = ctx;
  const empire = game.state.empires[game.playerId]!;
  const plans = planetPlans(game.state, pack, view, empire);
  const colonyDesign = empire.designs.find((d) => !d.obsolete && designStats(pack, d, empireEffects(pack, empire)).colonize);
  const speed = colonyDesign ? designStats(pack, colonyDesign, empireEffects(pack, empire)).speed : 0;
  const colors = pack.presentation.surveyColors;
  const dot = (color: string) => h("span", { className: "swatch", style: `background:${color}` });

  const legend = h(
    "div",
    { className: "legend small" },
    h("span", {}, dot(colors.habitable), "Habitable now"),
    h("span", {}, dot(colors.hostile), "Needs research"),
    h("span", {}, dot(colors.barren), "No planets"),
    h("span", {}, dot(colors.unexplored), "Not visited"),
  );

  const list = h("ul");
  for (const plan of plans) {
    const trip = Number.isFinite(plan.distance) && speed > 0 ? turnsText(Math.ceil(plan.distance / speed)) : "no known route";
    const value = plan.maxPop !== null ? `max pop ${plan.maxPop}` : `habitability ${plan.habitability}: needs research`;
    const row = h(
      "li",
      { className: "tappable" },
      h(
        "span",
        { className: "grow" },
        h("div", {}, dot(plan.maxPop !== null ? colors.habitable : colors.hostile), `${plan.systemName}: ${plan.label}`),
        h("div", { className: "muted small", textContent: `${plan.richness} minerals · ${value}` }),
      ),
      h("span", { className: "small", textContent: plan.distance === 0 ? "in a colony system" : trip }),
    );
    row.onclick = () => locate(plan.systemId);
    list.append(row);
  }
  if (plans.length === 0) list.append(h("li", {}, h("span", { className: "muted", textContent: "No unclaimed planets found yet. Explore more systems." })));

  const toggle = h("button", { textContent: showOnMap ? "Hide values on map" : "Show values on map" });
  toggle.onclick = () => toggleMap();
  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, "Colonization planner", closeButton(ctx)),
    legend,
    h("div", { className: "row" }, toggle),
    h("div", { className: "muted small", textContent: `Unclaimed planets in systems you have visited, best first. Travel times are for a ${colonyDesign?.name ?? "colony ship"} from your nearest colony.` }),
    list,
  );
}

import {
  FOCUSES,
  availableTechs,
  buildOptions,
  buyCost,
  colonyDefense,
  colonyOutput,
  defendingTroops,
  coloniesMissing,
  taxLevel,
  empireEconomy,
  techUnlocks,
  findColony,
  empireScore,
  getDesign,
  getTech,
  populationShares,
  turnLimit,
  itemCost,
  itemName,
  queueForecast,
  prospectiveMaxPop,
  type Colony,
  type ColonyId,
  type Command,
  type ContentPack,
  type Focus,
  type Game,
} from "../core";
import { bar, button, h, signed, turnsText } from "./dom";
import { designSummary } from "./shipPanels";

/** What the economy screens need from the game screen. */
export interface PanelContext {
  game: Game;
  pack: ContentPack;
  /** Issue a command; shows the error and returns false if rejected. Re-renders on success. */
  issue(command: Command): boolean;
  openColony(colonyId: ColonyId): void;
  openResearch(): void;
  openTechTree(): void;
  openEmpire(): void;
  close(): void;
  /** Re-render after issuing commands directly on the game. */
  refresh(): void;
  newGame(): void;
}

const FOCUS_LABELS: Record<Focus, string> = { balanced: "Balanced", industry: "Industry", research: "Research", food: "Food" };

function closeButton(ctx: PanelContext): HTMLButtonElement {
  return button("✕", ctx.close, { ariaLabel: "Close" });
}

/** Compact empire totals under the turn counter. Tapping opens the matching screen. */
export function resourceBar(ctx: PanelContext): HTMLElement {
  const { game, pack } = ctx;
  const empire = game.state.empires[game.playerId]!;
  const eco = empireEconomy(game.state, pack, game.playerId);
  const research = empire.research.current ? getTech(pack, empire.research.current) : null;
  const researchTurns = research && eco.research > 0 ? Math.max(1, Math.ceil((research.cost - empire.research.progress) / eco.research)) : null;

  const chip = (cls: string, label: string, value: string, onClick: () => void, warn = false) =>
    button("", onClick, { className: `chip ${cls}${warn ? " warn" : ""}`, ariaLabel: `${label} ${value}` });
  const ind = chip("ind", "Industry", String(eco.industry), ctx.openEmpire);
  ind.append(h("span", { className: "glyph", textContent: "⚙" }), String(eco.industry));
  const res = chip("res", "Research", `${eco.research}`, ctx.openResearch, !research);
  res.append(h("span", { className: "glyph", textContent: "⚛" }), research ? `${eco.research} · ${researchTurns}t` : `${eco.research} · pick`);
  const food = chip("food", "Food", `${empire.food}`, ctx.openEmpire, eco.netFood < 0);
  food.append(h("span", { className: "glyph", textContent: "☘" }), `${empire.food} ${signed(eco.netFood)}`);
  const cr = chip("cr", "Credits", `${empire.credits}`, ctx.openEmpire, empire.credits < 0);
  cr.append(h("span", { className: "glyph", textContent: "¢" }), `${empire.credits} ${signed(eco.netCredits)}`);
  return h("div", { className: "resources" }, ind, res, food, cr);
}

export function empirePanel(ctx: PanelContext): HTMLElement {
  const { game, pack } = ctx;
  const empire = game.state.empires[game.playerId]!;
  const eco = empireEconomy(game.state, pack, game.playerId);
  const row = (label: string, value: string, onClick?: () => void) => {
    const li = h("li", { className: onClick ? "tappable" : "" }, h("span", { textContent: label }), h("span", { textContent: value }));
    if (onClick) li.onclick = onClick;
    return li;
  };
  const colonies = game.state.colonies.filter((c) => c.empireId === game.playerId).sort((a, b) => Number(b.capital) - Number(a.capital) || a.id - b.id);
  const list = h("ul");
  const tax = taxLevel(pack, empire);
  const taxes = h("div", { className: "segmented" });
  for (const level of pack.taxLevels) {
    taxes.append(
      button(level.name, () => ctx.issue({ type: "setTaxLevel", empireId: game.playerId, taxLevel: level.id }), {
        className: level.id === tax.id ? "on" : "",
        ariaPressed: String(level.id === tax.id),
      }),
    );
  }
  const cap = pack.economy.foodStockCap;
  const setReserve = (reserve: number) => ctx.issue({ type: "setFoodReserve", empireId: game.playerId, reserve: Math.max(0, Math.min(cap, reserve)) });
  const reserve = h(
    "li",
    {},
    h("span", { className: "grow" }, h("div", { textContent: `Food reserve: keep ${empire.foodReserve}` }), h("div", { className: "muted small", textContent: `Food above this is sold for ${pack.economy.foodSalePercent / 100} credit each.` })),
    h("span", { className: "row-actions" }, button("−10", () => setReserve(empire.foodReserve - 10)), button("+10", () => setReserve(empire.foodReserve + 10))),
  );
  list.append(
    row("Industry (all colonies)", `${eco.industry} per turn`),
    row("Research", `${eco.research} per turn`),
    row("Food", `${eco.foodProduced} grown, ${eco.foodEaten} eaten · stock ${empire.food}/${cap}`),
    reserve,
    h("li", { className: "section" }, h("span", { textContent: "Finances" })),
    h("li", { className: "column-item" }, h("div", { className: "muted small", textContent: `Taxes: ${tax.description}` }), taxes),
    row("Taxes", `+${eco.income}`),
    row("Idle industry sold", `+${eco.idleCredits}`),
    row(`Food sold (${eco.foodSold})`, `+${eco.foodSales}`),
    row("Building upkeep", `-${eco.buildingUpkeep}`),
    row("Ship upkeep", `-${eco.shipUpkeep}`),
    row("Treasury", `${empire.credits} (${signed(eco.netCredits)} per turn)`),
  );
  if (empire.credits < 0) list.append(h("li", {}, h("span", { className: "warn-text", textContent: `In debt: industry and research -${pack.economy.debtPenaltyPercent}%` })));
  if (eco.netFood < 0 && empire.food + eco.netFood < 0) list.append(h("li", {}, h("span", { className: "warn-text", textContent: "Food runs out next turn: colonies will starve" })));
  // Score and the road to victory.
  const score = empireScore(game.state, pack, game.playerId);
  const share = populationShares(game.state).get(game.playerId) ?? 0;
  list.append(
    h("li", { className: "section" }, h("span", { textContent: "Victory" })),
    row("Your score", `${score.total}`),
    row("Share of galaxy population", `${share}% (domination at ${pack.victory.dominationPercent}% from turn ${pack.victory.dominationMinTurn})`),
    row("Turn limit", `${turnLimit(game.state, pack)}: highest score wins`),
  );

  // Rivals: what we know. Personalities show once we've met them.
  const known = new Set([...empire.sightings.map((s) => s.empireId), ...empire.colonySightings.map((c) => c.empireId)]);
  list.append(h("li", { className: "section" }, h("span", { textContent: "Rivals" })));
  for (const rival of game.state.empires) {
    if (rival.id === game.playerId) continue;
    const met = known.has(rival.id);
    const personality = pack.aiPersonalities.find((p) => p.id === rival.personality);
    const seenFleets = empire.sightings.filter((s) => s.empireId === rival.id && s.armed);
    const strength = seenFleets.reduce((n, s) => n + s.strength, 0);
    const colonies = empire.colonySightings.filter((c) => c.empireId === rival.id).length;
    const li = h(
      "li",
      {},
      h(
        "span",
        { className: "grow" },
        h("div", {}, h("span", { className: "swatch", style: `background:${rival.color}` }), `${rival.name}${rival.eliminated ? " (eliminated)" : ""}`),
        h("div", { className: "muted small", textContent: met ? `${personality?.name ?? "Unknown"}: ${personality?.description ?? ""}` : "Not yet met" }),
      ),
      h("span", { className: "small", textContent: met ? `${colonies} known colon${colonies === 1 ? "y" : "ies"} · fleets ~${strength}` : "" }),
    );
    list.append(li);
  }

  list.append(h("li", { className: "section" }, h("span", { textContent: "Colonies" })));
  for (const colony of colonies) {
    const out = colonyOutput(game.state, pack, colony);
    list.append(row(`${colony.capital ? "★ " : ""}${colony.name}`, `pop ${colony.population}/${out.maxPop} · ⚙${out.industry} ⚛${out.research}`, () => ctx.openColony(colony.id)));
  }
  return h("div", { className: "sheet panel" }, h("h2", {}, "Empire", closeButton(ctx)), list);
}

export function colonyPanel(ctx: PanelContext, colonyId: ColonyId): HTMLElement | null {
  const { game, pack } = ctx;
  const colony = findColony(game.state, colonyId);
  if (!colony || colony.empireId !== game.playerId) return null;
  const empire = game.state.empires[game.playerId]!;
  const out = colonyOutput(game.state, pack, colony);
  const threshold = pack.economy.growthThreshold;
  const growthText =
    colony.population >= out.maxPop ? "at max" : out.growth > 0 ? `+1 in ${turnsText(Math.max(1, Math.ceil((threshold - colony.growth) / out.growth)))}` : "not growing";

  const focus = h("div", { className: "segmented" });
  for (const f of FOCUSES) {
    focus.append(
      button(
        FOCUS_LABELS[f],
        () => {
          // Picking a focus hands workers back to it.
          if (colony.workers) game.issue({ type: "setWorkers", empireId: game.playerId, colonyId, workers: null });
          ctx.issue({ type: "setFocus", empireId: game.playerId, colonyId, focus: f });
        },
        {
          className: f === colony.focus && !colony.workers ? "on" : "",
          ariaPressed: String(f === colony.focus && !colony.workers),
        },
      ),
    );
  }

  // Hand-placed workers: "+" moves one worker here from the busiest other job.
  const jobs = ["farmers", "industry", "research"] as const;
  const jobLabel = { farmers: "Farmers", industry: "Industry", research: "Research" };
  const moveWorker = (to: (typeof jobs)[number]) => {
    const w = { ...out.workers };
    const from = jobs.filter((j) => j !== to && w[j] > 0).sort((a, b) => w[b] - w[a])[0];
    if (!from) return;
    w[from] -= 1;
    w[to] += 1;
    ctx.issue({ type: "setWorkers", empireId: game.playerId, colonyId, workers: w });
  };
  const workers = h(
    "div",
    { className: "workers" },
    ...jobs.map((j) => h("div", { className: "worker" }, h("span", { textContent: `${jobLabel[j]} ${out.workers[j]}` }), button("+", () => moveWorker(j), { ariaLabel: `Move a worker to ${jobLabel[j]}`, disabled: out.workers[j] === colony.population }))),
    colony.workers ? button("Auto", () => ctx.issue({ type: "setWorkers", empireId: game.playerId, colonyId, workers: null }), { title: "Let the focus place workers again" }) : null,
  );

  const stats = h(
    "div",
    { className: "stats" },
    stat("Industry", `${out.industry}`, `${out.workers.industry} workers`),
    stat("Research", `${out.research}`, `${out.workers.research} workers`),
    stat("Food", `${signed(out.food - out.foodEaten)}`, `${out.workers.farmers} farmers`),
    stat("Credits", `${signed(out.credits - out.upkeep)}`, `upkeep ${out.upkeep}`),
  );

  // Queue with forecasts.
  const forecast = queueForecast(game.state, pack, colony);
  const queue = h("ul");
  colony.queue.forEach((item, i) => {
    const cost = itemCost(pack, empire, item);
    const controls = h("span", { className: "row-actions" });
    if (i > 0) controls.append(button("↑", () => ctx.issue({ type: "prioritizeBuild", empireId: game.playerId, colonyId, index: i }), { ariaLabel: "Build next" }));
    controls.append(button("✕", () => ctx.issue({ type: "dequeueBuild", empireId: game.playerId, colonyId, index: i }), { ariaLabel: "Remove" }));
    const label = h("span", { className: "grow" }, h("div", { textContent: itemName(pack, empire, item, game.state, colony.systemId) }), h("div", { className: "muted small", textContent: `${turnsText(forecast[i]!)} · ${cost} ⚙` }));
    if (i === 0) label.append(bar(colony.progress / cost));
    queue.append(h("li", {}, label, controls));
  });
  if (colony.queue.length === 0) {
    const idle = Math.floor((out.industry * pack.economy.idleIndustryCreditsPercent) / 100);
    queue.append(h("li", {}, h("span", { className: "muted", textContent: `Nothing queued: industry is sold for ${idle} credits a turn.` })));
  }

  const cost = buyCost(pack, empire, colony);
  const buy =
    cost === null
      ? null
      : button(`Buy now for ${cost} ¢`, () => ctx.issue({ type: "buyBuild", empireId: game.playerId, colonyId }), {
          disabled: empire.credits < cost,
          title: empire.credits < cost ? "Not enough credits" : "Finishes at end of turn",
        });

  // What can be added.
  const options = h("ul");
  for (const item of buildOptions(game.state, pack, empire, colony)) {
    const itemCostValue = itemCost(pack, empire, item);
    const description =
      item.kind === "colonyBase"
        ? colonyBaseDescription(game, item.bodyId!)
        : item.kind === "building"
          ? pack.buildings.find((b) => b.id === item.id)!.description
          : designSummary(pack, empire, getDesign(empire, item.id));
    const alone = out.industry > 0 ? Math.ceil(itemCostValue / out.industry) : Infinity;
    const li = h(
      "li",
      { className: "tappable" },
      h("span", { className: "grow" }, h("div", { textContent: `${item.kind === "ship" ? "Ship: " : ""}${itemName(pack, empire, item, game.state, colony.systemId)}` }), h("div", { className: "muted small", textContent: description })),
      h("span", { textContent: `${itemCostValue} ⚙ · ${turnsText(alone)}` }),
    );
    li.onclick = () => ctx.issue({ type: "queueBuild", empireId: game.playerId, colonyId, item });
    options.append(li);
  }

  const buildings = h("ul");
  for (const id of colony.buildings) {
    const building = pack.buildings.find((b) => b.id === id)!;
    const refund = Math.floor((building.cost * pack.economy.scrapRefundPercent) / 100);
    const scrap = building.buildable
      ? button(`Scrap +${refund} ¢`, () => {
          if (confirm(`Scrap the ${building.name}? You get ${refund} credits back and its upkeep (${building.upkeep}) stops.`)) {
            ctx.issue({ type: "scrapBuilding", empireId: game.playerId, colonyId, buildingId: id });
          }
        }, { className: "small-button" })
      : h("span", { className: "muted small", textContent: "permanent" });
    buildings.append(h("li", {}, h("span", { className: "grow" }, h("div", { textContent: building.name }), h("div", { className: "muted small", textContent: `${building.description} Upkeep ${building.upkeep}.` })), scrap));
  }
  if (colony.buildings.length === 0) buildings.append(h("li", {}, h("span", { className: "muted", textContent: "None" })));

  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, `${colony.capital ? "★ " : ""}${colony.name}`, closeButton(ctx)),
    h("div", { className: "sub", textContent: `Population ${colony.population}/${out.maxPop} · ${growthText}` }),
    focus,
    workers,
    stats,
    defensePanel(ctx, colony),
    h("h3", { textContent: "Building" }),
    queue,
    buy,
    h("h3", { textContent: "Add to queue" }),
    options,
    h("h3", { textContent: "Buildings" }),
    buildings,
  );
}

/** Orbital defenses, garrison and mines at one of the player's colonies. */
function defensePanel(ctx: PanelContext, colony: Colony): HTMLElement {
  const { game, pack } = ctx;
  const empire = game.state.empires[colony.empireId]!;
  const d = colonyDefense(pack, empire, colony);
  const troops = defendingTroops(game.state, pack, colony);
  const mines = game.state.minefields.find((m) => m.systemId === colony.systemId && m.empireId === colony.empireId)?.strength ?? 0;
  const lines: (HTMLElement | null)[] = [];
  if (d.maxHp > 0) {
    lines.push(h("div", { className: "small", textContent: `Orbital defenses ${colony.defenseHp}/${d.maxHp} hp · ${d.weapons.length} gun${d.weapons.length === 1 ? "" : "s"}${d.shield ? ` · shield ${d.shield}` : ""}` }), bar(colony.defenseHp / d.maxHp));
  } else {
    lines.push(h("div", { className: "muted small", textContent: "No orbital defenses: enemy warships can blockade freely and troops can land." }));
  }
  lines.push(h("div", { className: "small", textContent: `Ground troops ${troops} (garrison ${colony.troops}/${d.maxTroops} + militia ${colony.population * pack.combat.militiaPerPop}, with terrain and tech)` }));
  if (mines > 0) lines.push(h("div", { className: "small", textContent: `Minefield strength ${mines}` }));
  if (colony.blockaded) lines.push(h("div", { className: "danger-text small", textContent: "Under siege: no repairs, supply or trade until the blockade is broken." }));
  return h("div", { className: "defense-box" }, h("h3", { textContent: "Defenses" }), ...lines);
}

function stat(label: string, value: string, note: string): HTMLElement {
  return h("div", { className: "stat" }, h("div", { className: "muted small", textContent: label }), h("div", { className: "stat-value", textContent: value }), h("div", { className: "muted small", textContent: note }));
}

export function researchPanel(ctx: PanelContext): HTMLElement {
  const { game, pack } = ctx;
  const empire = game.state.empires[game.playerId]!;
  const eco = empireEconomy(game.state, pack, game.playerId);
  const fieldName = (id: string) => pack.researchFields.find((f) => f.id === id)?.name ?? id;
  const turnsFor = (cost: number) => (eco.research > 0 ? Math.max(1, Math.ceil((cost - empire.research.progress) / eco.research)) : Infinity);

  const current = empire.research.current ? getTech(pack, empire.research.current) : null;
  const header = current
    ? h(
        "div",
        { className: "current-research" },
        h("div", { textContent: `${current.name} (${fieldName(current.field)})` }),
        bar(empire.research.progress / current.cost),
        h("div", { className: "muted small", textContent: `${empire.research.progress}/${current.cost} · ${eco.research} per turn · ${turnsText(turnsFor(current.cost))}` }),
      )
    : h("div", { className: "current-research warn-text", textContent: `Choose a tech. ${empire.research.progress} points banked, ${eco.research} per turn.` });

  const list = h("ul");
  for (const tech of availableTechs(pack, empire).sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))) {
    const li = h(
      "li",
      { className: `tappable${tech.id === current?.id ? " on" : ""}` },
      h("span", { className: "grow" }, h("div", { textContent: tech.name }), h("div", { className: "muted small", textContent: `${fieldName(tech.field)} · ${tech.description}` })),
      h("span", { textContent: `${tech.cost} · ${turnsText(turnsFor(tech.cost))}` }),
    );
    li.onclick = () => ctx.issue({ type: "setResearch", empireId: game.playerId, techId: tech.id });
    list.append(li);
  }
  if (list.childElementCount === 0) list.append(h("li", {}, h("span", { className: "muted", textContent: "Everything known has been researched." })));

  const known = empire.techs.map((id) => getTech(pack, id).name).join(", ") || "None yet";
  // Researched buildings some colonies still lack, with one-tap queueing.
  const offers = empire.techs.flatMap((id) => queueEverywhere(ctx, id));
  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, "Research", closeButton(ctx)),
    header,
    h("div", { className: "row" }, button("Full research tree", () => ctx.openTechTree())),
    offers.length ? h("h3", { textContent: "New buildings" }) : null,
    offers.length ? h("div", { className: "column" }, ...offers) : null,
    h("h3", { textContent: "Available" }),
    list,
    h("h3", { textContent: `Researched (${empire.techs.length}/${pack.techs.length})` }),
    h("div", { className: "muted", textContent: known }),
  );
}

/** Final standings. Everything is revealed once the game is over. */
export function gameOverPanel(ctx: PanelContext): HTMLElement | null {
  const { game, pack } = ctx;
  const outcome = game.state.outcome;
  if (!outcome) return null;
  const won = outcome.winnerId === game.playerId;
  const winner = game.state.empires[outcome.winnerId]!;
  const reason = { domination: "by holding a dominant share of the galaxy's population", turnLimit: "with the highest score at the turn limit", elimination: "as the last empire standing" }[outcome.reason];
  const list = h("ul");
  const standings = game.state.empires
    .map((e) => ({ e, score: empireScore(game.state, pack, e.id) }))
    .sort((a, b) => b.score.total - a.score.total || a.e.id - b.e.id);
  for (const { e, score } of standings) {
    const personality = pack.aiPersonalities.find((p) => p.id === e.personality);
    list.append(
      h(
        "li",
        {},
        h("span", { className: "grow" }, h("div", {}, h("span", { className: "swatch", style: `background:${e.color}` }), `${e.name}${e.id === game.playerId ? " (you)" : ""}`), h("div", { className: "muted small", textContent: personality ? personality.name : "Player" })),
        h("span", { className: "small", textContent: `${score.total} pts · ${score.colonies} colonies · pop ${score.population} · ${score.techs} techs` }),
      ),
    );
  }
  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, won ? "Victory!" : "Game over", button("✕", ctx.close, { ariaLabel: "Close" })),
    h("div", { className: "sub", textContent: `${won ? "You win" : `${winner.name} wins`} ${reason}, turn ${outcome.turn}.` }),
    list,
    button("New game", () => ctx.newGame(), { className: "primary" }),
  );
}

/** What a colony base would found: the planet and how large the colony could grow. */
function colonyBaseDescription(game: Game, bodyId: number): string {
  const pack = game.pack;
  const empire = game.state.empires[game.playerId]!;
  const body = game.state.galaxy.systems.flatMap((s) => s.bodies).find((b) => b.id === bodyId)!;
  const type = pack.planetTypes.find((t) => t.id === body.planetType)?.name ?? "";
  const size = pack.planetSizes.find((t) => t.id === body.size)?.name ?? "";
  return `Settle the ${size} ${type} world in this system without a colony ship (max pop ${prospectiveMaxPop(pack, empire, body)}).`;
}

/**
 * Buttons to add each building a tech unlocks to every colony that can still build it,
 * at the back of their queues. Empty when every colony already has it built or queued.
 */
export function queueEverywhere(ctx: PanelContext, techId: string): HTMLElement[] {
  const { game, pack } = ctx;
  return techUnlocks(pack, techId).buildings.flatMap((buildingId) => {
    const colonies = coloniesMissing(game.state, pack, game.playerId, buildingId);
    if (colonies.length === 0) return [];
    const building = pack.buildings.find((b) => b.id === buildingId)!;
    const where = colonies.length === 1 ? colonies[0]!.name : `all ${colonies.length} colonies`;
    return [
      button(`Queue ${building.name} at ${where} (${building.cost} ⚙ each)`, () => {
        for (const colony of colonies) game.issue({ type: "queueBuild", empireId: game.playerId, colonyId: colony.id, item: { kind: "building", id: buildingId } });
        ctx.refresh();
      }),
    ];
  });
}

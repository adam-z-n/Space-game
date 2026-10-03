import {
  FOCUSES,
  availableTechs,
  buildOptions,
  buyCost,
  colonyOutput,
  empireEconomy,
  findColony,
  empireScore,
  getDesign,
  getTech,
  populationShares,
  turnLimit,
  itemCost,
  itemName,
  queueForecast,
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
  openEmpire(): void;
  close(): void;
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
  list.append(
    row("Industry (all colonies)", `${eco.industry} per turn`),
    row("Research", `${eco.research} per turn`),
    row("Food", `${eco.foodProduced} grown, ${eco.foodEaten} eaten · stock ${empire.food}/${pack.economy.foodStockCap}`),
    row("Taxes", `+${eco.income}`),
    row("Idle industry sold", `+${eco.idleCredits}`),
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
      button(FOCUS_LABELS[f], () => ctx.issue({ type: "setFocus", empireId: game.playerId, colonyId, focus: f }), {
        className: f === colony.focus ? "on" : "",
        ariaPressed: String(f === colony.focus),
      }),
    );
  }

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
    const label = h("span", { className: "grow" }, h("div", { textContent: itemName(pack, empire, item) }), h("div", { className: "muted small", textContent: `${turnsText(forecast[i]!)} · ${cost} ⚙` }));
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
  for (const item of buildOptions(pack, empire, colony)) {
    const itemCostValue = itemCost(pack, empire, item);
    const description = item.kind === "building" ? pack.buildings.find((b) => b.id === item.id)!.description : designSummary(pack, empire, getDesign(empire, item.id));
    const alone = out.industry > 0 ? Math.ceil(itemCostValue / out.industry) : Infinity;
    const li = h(
      "li",
      { className: "tappable" },
      h("span", { className: "grow" }, h("div", { textContent: `${item.kind === "ship" ? "Ship: " : ""}${itemName(pack, empire, item)}` }), h("div", { className: "muted small", textContent: description })),
      h("span", { textContent: `${itemCostValue} ⚙ · ${turnsText(alone)}` }),
    );
    li.onclick = () => ctx.issue({ type: "queueBuild", empireId: game.playerId, colonyId, item });
    options.append(li);
  }

  const buildings = colony.buildings.map((id) => pack.buildings.find((b) => b.id === id)!.name).join(", ") || "None";

  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, `${colony.capital ? "★ " : ""}${colony.name}`, closeButton(ctx)),
    h("div", { className: "sub", textContent: `Population ${colony.population}/${out.maxPop} · ${growthText}` }),
    focus,
    stats,
    h("h3", { textContent: "Building" }),
    queue,
    buy,
    h("h3", { textContent: "Add to queue" }),
    options,
    h("h3", { textContent: "Buildings" }),
    h("div", { className: "muted", textContent: buildings }),
  );
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
  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, "Research", closeButton(ctx)),
    header,
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

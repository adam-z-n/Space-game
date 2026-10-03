import {
  FORMATIONS,
  componentAvailable,
  designBlocker,
  designStats,
  empireEffects,
  findFleet,
  fleetMaxSupply,
  fleetShipStats,
  fleetStrength,
  getComponent,
  getDesign,
  getHull,
  hullAvailable,
  type BattleReport,
  type Command,
  type ContentPack,
  type Empire,
  type FleetId,
  type FleetOrders,
  type Formation,
  type Game,
  type ShipDesign,
} from "../core";
import { bar, button, h } from "./dom";
import { spriteIcon } from "./sprites";

/** What the ship screens need from the game screen. */
export interface ShipContext {
  game: Game;
  pack: ContentPack;
  issue(command: Command): boolean;
  /** Redraw the current screen after a UI-only change. */
  rerender(): void;
  /** Open the designer on a fresh draft, optionally copied from a design. */
  newDesign(base?: ShipDesign): void;
  openDesigner(): void;
  openDesigns(): void;
  close(): void;
  empireName(id: number): string;
  /** Hull for a ship in a battle report, if its design is known to the viewer (own ships, or seen designs). */
  hullOf(shipId: number, empireId: number, designName: string): string | null;
  empireColor(id: number): string;
  systemName(id: number): string;
}

const FORMATION_LABELS: Record<Formation, string> = { front: "Front line", screen: "Screen", support: "Support" };

/** One line describing a design: hull, parts, key numbers. */
export function designSummary(pack: ContentPack, empire: Empire, design: Pick<ShipDesign, "hull" | "components">): string {
  const stats = designStats(pack, design, empireEffects(pack, empire));
  const counts = new Map<string, number>();
  for (const id of design.components) counts.set(id, (counts.get(id) ?? 0) + 1);
  const parts = [...counts].map(([id, n]) => `${n > 1 ? `${n}× ` : ""}${getComponent(pack, id).name}`).join(", ") || "empty";
  const attack = stats.armed ? ` · ${stats.damagePerRound.toFixed(1)} dmg/round` : "";
  const extras = [stats.troops ? `${stats.troops} troops` : "", stats.repair ? `repairs ${stats.repair}%/turn` : "", stats.mines ? `lays ${stats.mines} mines/turn` : ""].filter(Boolean);
  return `${getHull(pack, design.hull).name}: ${parts} · ${stats.maxHp} hp${stats.shield ? ` · shield ${stats.shield}` : ""}${attack} · speed ${stats.speed}${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
}

// ---------- designs list ----------

export function designsPanel(ctx: ShipContext): HTMLElement {
  const { game, pack } = ctx;
  const empire = game.state.empires[game.playerId]!;
  const list = h("ul");
  for (const design of empire.designs.filter((d) => !d.obsolete)) {
    const stats = designStats(pack, design, empireEffects(pack, empire));
    list.append(
      h(
        "li",
        {},
        spriteIcon(pack, design.hull, empire.color, 2),
        h("span", { className: "grow" }, h("div", { textContent: `${design.name} · ${stats.cost} ⚙ · upkeep ${stats.upkeep}` }), h("div", { className: "muted small", textContent: designSummary(pack, empire, design) })),
        h(
          "span",
          { className: "row-actions" },
          button("Copy", () => ctx.newDesign(design), { ariaLabel: `Copy ${design.name}` }),
          button("Retire", () => ctx.issue({ type: "retireDesign", empireId: game.playerId, designId: design.id }), { ariaLabel: `Retire ${design.name}` }),
        ),
      ),
    );
  }
  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, "Ship designs", button("✕", ctx.close, { ariaLabel: "Close" })),
    h("div", { className: "hint", textContent: "Retired designs stop appearing in build lists; ships already built keep flying." }),
    button("New design", () => ctx.newDesign(), { className: "primary" }),
    list,
  );
}

// ---------- designer ----------

interface Draft {
  name: string;
  hull: string;
  components: string[];
  formation: Formation;
}

let draft: Draft | null = null;

export function startDraft(pack: ContentPack, empire: Empire, base?: ShipDesign): void {
  const hull = base?.hull ?? pack.hulls.find((h) => hullAvailable(pack, empire, h.id))!.id;
  draft = {
    name: base ? `${base.name} II` : "",
    hull,
    components: base ? [...base.components] : [],
    formation: base?.formation ?? "front",
  };
}

export function designerPanel(ctx: ShipContext): HTMLElement {
  const { game, pack } = ctx;
  const empire = game.state.empires[game.playerId]!;
  if (!draft) startDraft(pack, empire);
  const d = draft!;
  const hull = getHull(pack, d.hull);

  const name = h("input", { value: d.name, placeholder: "Design name", maxLength: 30 });
  name.oninput = () => (d.name = name.value);

  const hulls = h("div", { className: "segmented wrap" });
  for (const option of pack.hulls.filter((x) => hullAvailable(pack, empire, x.id))) {
    const b = button(`${option.name} (${option.slots})`, () => {
        d.hull = option.id;
        d.components = d.components.slice(0, option.slots);
        ctx.rerender();
      }, { className: `hull-option${option.id === d.hull ? " on" : ""}` });
    b.prepend(spriteIcon(pack, option.id, empire.color, 2));
    hulls.append(b);
  }

  const slots = h("ul");
  d.components.forEach((id, i) => {
    slots.append(
      h(
        "li",
        {},
        h("span", { className: "grow", textContent: getComponent(pack, id).name }),
        button("✕", () => {
          d.components.splice(i, 1);
          ctx.rerender();
        }, { ariaLabel: "Remove" }),
      ),
    );
  });
  for (let i = d.components.length; i < hull.slots; i++) slots.append(h("li", {}, h("span", { className: "muted", textContent: "Empty slot" })));

  const parts = h("ul");
  for (const c of pack.components.filter((x) => componentAvailable(pack, empire, x.id))) {
    const li = h("li", { className: d.components.length < hull.slots ? "tappable" : "muted" }, h("span", { className: "grow" }, h("div", { textContent: c.name }), h("div", { className: "muted small", textContent: c.description })), h("span", { textContent: `${c.cost} ⚙` }));
    li.onclick = () => {
      if (d.components.length >= hull.slots) return;
      d.components.push(c.id);
      ctx.rerender();
    };
    parts.append(li);
  }

  const formation = h("div", { className: "segmented" });
  for (const f of FORMATIONS) {
    formation.append(
      button(FORMATION_LABELS[f], () => {
        d.formation = f;
        ctx.rerender();
      }, { className: f === d.formation ? "on" : "" }),
    );
  }

  const stats = designStats(pack, d, empireEffects(pack, empire));
  const summary = h(
    "div",
    { className: "stats" },
    stat("Cost", `${stats.cost}`, `upkeep ${stats.upkeep}`),
    stat("Hull", `${stats.maxHp}`, stats.shield ? `shield ${stats.shield}` : "no shield"),
    stat("Attack", stats.damagePerRound.toFixed(1), `${stats.weapons.length} weapons`),
    stat("Speed", `${stats.speed}`, `${stats.endurance}${stats.fuel ? `+${stats.fuel}` : ""} turns`),
  );

  const save = button(
    "Save design",
    () => {
      const design = { name: d.name, hull: d.hull, components: [...d.components], formation: d.formation };
      const error = designBlocker(pack, empire, design);
      if (error) return alert(error);
      if (ctx.issue({ type: "createDesign", empireId: game.playerId, design })) {
        draft = null;
        ctx.openDesigns();
      }
    },
    { className: "primary" },
  );

  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, "Ship designer", button("✕", () => ((draft = null), ctx.openDesigns()), { ariaLabel: "Close" })),
    h("div", { className: "designer-preview" }, spriteIcon(pack, d.hull, empire.color, 5)),
    name,
    h("h3", { textContent: "Hull" }),
    hulls,
    h("div", { className: "muted small", textContent: hull.description + ` Evasion ${hull.evasion}%, sensors ${stats.sensorRange}, role: ${stats.role}.` }),
    summary,
    h("h3", { textContent: `Slots (${d.components.length}/${hull.slots})` }),
    slots,
    h("h3", { textContent: "Formation" }),
    formation,
    h("div", { className: "hint", textContent: "Front line ships draw most enemy fire; support ships the least." }),
    save,
    h("h3", { textContent: "Components" }),
    parts,
  );
}

function stat(label: string, value: string, note: string): HTMLElement {
  return h("div", { className: "stat" }, h("div", { className: "muted small", textContent: label }), h("div", { className: "stat-value", textContent: value }), h("div", { className: "muted small", textContent: note }));
}

// ---------- fleet details (own fleets) ----------

const selectedShips = new Set<number>();
/** Orders are folded into a one-line summary until opened, to keep the map visible. */
let ordersOpenFor: FleetId | null = null;

const ORDER_LABELS = {
  mission: { engage: "Engage", evade: "Evade" },
  stance: { aggressive: "Aggressive", balanced: "Balanced", cautious: "Cautious" },
  targetPriority: { warships: "warships first", transports: "transports first", any: "any target" },
} as const;

/** Ships, supply and standing orders for one of the player's fleets. */
export function fleetDetail(ctx: ShipContext, fleetId: FleetId): HTMLElement | null {
  const { game, pack } = ctx;
  const fleet = findFleet(game.state, fleetId);
  if (!fleet || fleet.empireId !== game.playerId) return null;
  const empire = game.state.empires[game.playerId]!;
  const stats = fleetShipStats(pack, game.state, fleet);
  const maxSupply = fleetMaxSupply(pack, game.state, fleet);
  for (const id of [...selectedShips]) if (!fleet.ships.some((s) => s.id === id)) selectedShips.delete(id);

  const supply =
    fleet.supply >= maxSupply
      ? h("div", { className: "muted small", textContent: `Supplied · ${maxSupply} turns of endurance` })
      : fleet.supply > 0
        ? h("div", { className: "warn-text small", textContent: `Outside supply · ${fleet.supply}/${maxSupply} turns left` })
        : h("div", { className: "danger-text small", textContent: "Out of supply: slower, half damage, losing hull each turn" });

  // Ships: one line per design when there are many, individual rows (selectable) when few or when detaching.
  const ships = h("ul");
  fleet.ships.forEach((ship, i) => {
    const s = stats[i]!;
    const on = selectedShips.has(ship.id);
    const li = h(
      "li",
      { className: `tappable${on ? " on" : ""}` },
      spriteIcon(pack, getDesign(empire, ship.designId).hull, empire.color, 2),
      h("span", { className: "grow" }, h("div", { textContent: `${on ? "☑ " : ""}${getDesign(empire, ship.designId).name}` }), bar(ship.hp / s.maxHp)),
      h("span", { className: "small", textContent: `${ship.hp}/${s.maxHp}` }),
    );
    li.onclick = () => {
      if (on) selectedShips.delete(ship.id);
      else selectedShips.add(ship.id);
      ctx.rerender();
    };
    ships.append(li);
  });

  const orders = fleet.orders;
  const setOrders = (patch: Partial<FleetOrders>) => ctx.issue({ type: "setFleetOrders", empireId: game.playerId, fleetId, orders: { ...orders, ...patch } });
  const segment = <T extends string | number>(options: [T, string][], current: T, apply: (v: T) => void) => {
    const row = h("div", { className: "segmented" });
    for (const [value, label] of options) row.append(button(label, () => apply(value), { className: value === current ? "on" : "" }));
    return row;
  };

  const inSystem = fleet.progress === 0;
  const others = game.state.fleets.filter((f) => f.empireId === game.playerId && f.id !== fleet.id && inSystem && f.progress === 0 && f.systemId === fleet.systemId);
  const actions = h("div", { className: "column" });
  for (const other of others) actions.append(button(`Merge ${other.name} into this fleet`, () => ctx.issue({ type: "mergeFleets", empireId: game.playerId, fleetId: other.id, intoFleetId: fleet.id })));
  if (inSystem && selectedShips.size > 0 && selectedShips.size < fleet.ships.length) {
    actions.append(
      button(`Detach ${selectedShips.size} selected ship${selectedShips.size > 1 ? "s" : ""}`, () => {
        const ids = [...selectedShips];
        selectedShips.clear();
        ctx.issue({ type: "splitFleet", empireId: game.playerId, fleetId, shipIds: ids });
      }),
    );
  }

  return h(
    "div",
    {},
    h("div", { className: "muted small", textContent: `${fleet.ships.length} ship${fleet.ships.length > 1 ? "s" : ""} · strength ${fleetStrength(pack, game.state, fleet)} · speed ${fleet.speed}` }),
    supply,
    ships,
    fleet.ships.length > 1 ? h("div", { className: "hint", textContent: "Tap ships to select them for detaching." }) : null,
    ordersOpenFor === fleet.id
      ? h(
          "div",
          {},
          h("h3", {}, "Orders"),
          segment<FleetOrders["mission"]>([["engage", "Engage"], ["evade", "Evade"]], orders.mission, (mission) => setOrders({ mission })),
          segment<FleetOrders["stance"]>([["aggressive", "Aggressive"], ["balanced", "Balanced"], ["cautious", "Cautious"]], orders.stance, (stance) => setOrders({ stance })),
          h("div", { className: "muted small", textContent: "Target first" }),
          segment<FleetOrders["targetPriority"]>([["warships", "Warships"], ["transports", "Transports"], ["any", "Anything"]], orders.targetPriority, (targetPriority) => setOrders({ targetPriority })),
          h("div", { className: "muted small", textContent: "Retreat after losing" }),
          segment<number>([[25, "25%"], [50, "50%"], [75, "75%"], [100, "Never"]], orders.retreatPercent, (retreatPercent) => setOrders({ retreatPercent })),
          button("Done", () => ((ordersOpenFor = null), ctx.rerender())),
        )
      : h(
          "div",
          { className: "orders-summary" },
          h("span", {
            className: "small",
            textContent: `${ORDER_LABELS.mission[orders.mission]} · ${ORDER_LABELS.stance[orders.stance]} · ${ORDER_LABELS.targetPriority[orders.targetPriority]} · ${orders.retreatPercent >= 100 ? "never retreat" : `retreat at ${orders.retreatPercent}%`}`,
          }),
          button("Change", () => ((ordersOpenFor = fleet.id), ctx.rerender()), { className: "small-button" }),
        ),
    actions.childElementCount ? actions : null,
  );
}

// ---------- battle report ----------

export function battlePanel(ctx: ShipContext, report: BattleReport, round: number, setRound: (r: number) => void): HTMLElement {
  const viewer = ctx.game.playerId;
  const shipInfo = new Map(report.ships.map((s) => [s.shipId, s]));
  // Replay hit points up to the end of the chosen round.
  const hp = new Map(report.ships.map((s) => [s.shipId, s.hp]));
  for (let r = 0; r <= round && r < report.rounds.length; r++) for (const shot of report.rounds[r]!.shots) hp.set(shot.target, hp.get(shot.target)! - shot.damage);

  const label = (shipId: number) => {
    const s = shipInfo.get(shipId)!;
    return `${s.designName}${s.empireId === viewer ? " (yours)" : ""}`;
  };

  const sides = h("div", { className: "column" });
  for (const result of report.results) {
    const mine = report.ships.filter((s) => s.empireId === result.empireId);
    const alive = h("div", { className: "battle-ships" });
    for (const s of mine) {
      const now = Math.max(0, hp.get(s.shipId)!);
      const hull = ctx.hullOf(s.shipId, s.empireId, s.designName);
      alive.append(
        h(
          "div",
          { className: `battle-ship${now <= 0 ? " dead" : ""}`, title: `${s.designName} ${now}/${s.maxHp}` },
          hull ? spriteIcon(ctx.pack, hull, ctx.empireColor(s.empireId), 2, now <= 0) : null,
          h("span", { className: "small", textContent: s.designName }),
          bar(now / s.maxHp),
        ),
      );
    }
    sides.append(
      h(
        "div",
        { className: "battle-side" },
        h("div", {}, h("span", { className: "swatch", style: `background:${ctx.empireColor(result.empireId)}` }), `${ctx.empireName(result.empireId)}${result.empireId === viewer ? " (you)" : ""}`),
        h("div", { className: "muted small", textContent: `${mine.length} ships · lost ${result.shipsLost} · dealt ${result.damageDealt} damage${result.retreated.length ? " · withdrew" : ""}` }),
        alive,
      ),
    );
  }

  const rounds = h("div", { className: "segmented" });
  report.rounds.forEach((_, i) => rounds.append(button(`Round ${i + 1}`, () => setRound(i), { className: i === round ? "on" : "" })));

  const log = h("ul");
  const current = report.rounds[round];
  if (current) {
    const hits = current.shots.filter((s) => s.damage > 0);
    const misses = current.shots.length - hits.length;
    for (const shot of hits) {
      log.append(h("li", {}, h("span", { className: "small", textContent: `${label(shot.attacker)} hit ${label(shot.target)} for ${shot.damage}${shot.destroyed ? " — destroyed" : ""}` })));
    }
    if (misses > 0) log.append(h("li", {}, h("span", { className: "muted small", textContent: `${misses} shot${misses > 1 ? "s" : ""} missed` })));
    for (const fleetId of current.retreated) {
      const ship = report.ships.find((s) => s.fleetId === fleetId);
      if (ship) log.append(h("li", {}, h("span", { className: "warn-text small", textContent: `${ctx.empireName(ship.empireId)} fleet withdrew` })));
    }
  }

  return h(
    "div",
    { className: "sheet panel tall" },
    h("h2", {}, `Battle at ${ctx.systemName(report.systemId)}`, button("✕", ctx.close, { ariaLabel: "Close" })),
    sides,
    h("h3", { textContent: "Replay" }),
    rounds,
    log,
  );
}

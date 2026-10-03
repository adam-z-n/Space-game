import {
  Game,
  MAX_AI,
  MIN_AI,
  attentionItems,
  deserializeSave,
  empireView,
  omniscientView,
  planMove,
  serializeSave,
  type EmpireView,
  type FleetId,
  type FleetView,
  type GameEvent,
  type GameSettings,
  type SystemId,
} from "../core";
import { defaultPack } from "../content/defaultPack";
import { onAppBackground } from "../platform/lifecycle";
import { LocalSaveStore } from "../platform/storage";
import { GalaxyMap, type MapTarget, type RoutePreview } from "./map";

const AUTOSAVE = "autosave";
const pack = defaultPack();
const store = new LocalSaveStore();
const root = document.getElementById("app")!;

// ---------- helpers ----------

type Props<E> = Partial<Omit<E, "style">> & { style?: string };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const { style, ...rest } = props;
  const el = Object.assign(document.createElement(tag), rest);
  if (style) el.setAttribute("style", style);
  for (const child of children) if (child !== null) el.append(child);
  return el;
}

function button(label: string, onClick: () => void, props: Props<HTMLButtonElement> = {}): HTMLButtonElement {
  const b = h("button", { textContent: label, ...props });
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

function randomSeed(): string {
  const words = ["amber", "cobalt", "ember", "frost", "nova", "onyx", "quasar", "rift", "solar", "vanta", "zenith", "drift"];
  const pick = () => words[Math.floor(Math.random() * words.length)]!;
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 1000)}`;
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = h("a", { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: ".json,application/json" });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}

const turnsText = (n: number) => (n === 1 ? "1 turn" : `${n} turns`);

// ---------- setup screen ----------

async function showSetup(message?: string): Promise<void> {
  root.replaceChildren();
  const saved = await store.read(AUTOSAVE);

  const seed = h("input", { value: randomSeed(), autocomplete: "off", spellcheck: false });
  const size = h("select");
  for (const g of pack.galaxySizes) size.append(h("option", { value: g.id, textContent: `${g.name} (${g.systems} systems)`, selected: g.id === "medium" }));
  const ai = h("select");
  for (let n = MIN_AI; n <= MAX_AI; n++) ai.append(h("option", { value: String(n), textContent: `${n} rivals`, selected: n === 3 }));
  const error = h("p", { className: "error", textContent: message ?? "" });

  const start = button(
    "Start new game",
    () => {
      const settings: GameSettings = { seed: seed.value.trim(), galaxySize: size.value, aiCount: Number(ai.value) };
      try {
        startGame(Game.create(settings, pack));
      } catch (e) {
        error.textContent = (e as Error).message;
      }
    },
    { className: "primary" },
  );

  const importBtn = button("Import save file", async () => {
    const text = await pickFile();
    if (text) loadAndStart(text);
  });

  root.append(
    h(
      "div",
      { className: "setup" },
      h("h1", { textContent: "Space 4X" }),
      h("p", { textContent: "Milestone 2 preview: fog of war, fleet orders, and the turn loop." }),
      saved ? button("Continue", () => loadAndStart(saved), { className: "primary" }) : null,
      h("label", {}, "Galaxy seed", h("div", { className: "row" }, seed, button("Random", () => (seed.value = randomSeed()), { type: "button" }))),
      h("label", {}, "Galaxy size", size),
      h("label", {}, "AI empires", ai),
      start,
      importBtn,
      error,
    ),
  );
}

function loadAndStart(json: string): void {
  try {
    startGame(deserializeSave(json, pack));
  } catch (e) {
    void showSetup(`Could not load save: ${(e as Error).message}`);
  }
}

// ---------- game screen ----------

let stopAutosave: (() => void) | null = null;

interface UiState {
  selectedSystem: SystemId | null;
  selectedFleet: FleetId | null;
  /** A destination being considered for the selected fleet, waiting for confirmation. */
  preview: (RoutePreview & { destinationId: SystemId }) | null;
  report: GameEvent[] | null;
  panel: "none" | "menu" | "fleets";
  contextMenu: { target: MapTarget; x: number; y: number } | null;
  revealMap: boolean;
  /** Index into the attention queue for the "next idle" button. */
  idleCursor: number;
}

function startGame(game: Game): void {
  stopAutosave?.();
  root.replaceChildren();

  const ui: UiState = {
    selectedSystem: game.state.empires[game.playerId]!.homeSystemId,
    selectedFleet: null,
    preview: null,
    report: null,
    panel: "none",
    contextMenu: null,
    revealMap: false,
    idleCursor: 0,
  };

  const save = () => store.write(AUTOSAVE, serializeSave(game)).catch(() => {});
  stopAutosave = onAppBackground(() => void save());
  void save();

  let view: EmpireView = empireView(game.state, game.playerId);
  const fleetView = (id: FleetId | null) => (id === null ? undefined : view.fleets.find((f) => f.id === id));
  const systemName = (id: SystemId) => view.systems[id]!.name;
  const empire = (id: number) => view.empires[id]!;

  const map = new GalaxyMap(root, pack, {
    onTap: (target) => {
      if (ui.contextMenu || ui.panel !== "none") {
        ui.contextMenu = null;
        ui.panel = "none";
        return update();
      }
      const selected = fleetView(ui.selectedFleet);
      if (target?.kind === "system" && selected?.own) {
        if (ui.preview?.destinationId === target.id) return confirmPreview();
        return setPreview(selected.id, target.id);
      }
      selectTarget(target);
    },
    onLongPress: (target, x, y) => {
      ui.contextMenu = { target, x, y };
      update();
    },
    onDragOrder: (fleetId, systemId, final) => {
      ui.selectedFleet = fleetId;
      ui.selectedSystem = null;
      ui.contextMenu = null;
      if (systemId === null) {
        ui.preview = null;
        return update();
      }
      setPreview(fleetId, systemId);
      if (final) confirmPreview();
    },
  });

  const hud = h("div", { className: "hud" });
  root.append(hud);

  function selectTarget(target: MapTarget | null): void {
    ui.preview = null;
    ui.contextMenu = null;
    ui.selectedFleet = target?.kind === "fleet" ? target.id : null;
    ui.selectedSystem = target?.kind === "system" ? target.id : null;
    if (target) ui.report = null;
    update();
  }

  function setPreview(fleetId: FleetId, destinationId: SystemId): void {
    const plan = planMove(game.state, fleetId, destinationId);
    ui.preview = typeof plan === "string" ? null : { fleetId, route: plan.route, turns: plan.turns, destinationId };
    update();
  }

  function confirmPreview(): void {
    const preview = ui.preview;
    if (!preview) return;
    const error = game.issue({ type: "moveFleet", empireId: game.playerId, fleetId: preview.fleetId, destinationId: preview.destinationId });
    if (error) alert(error);
    ui.preview = null;
    navigator.vibrate?.(8);
    update();
  }

  function setHold(fleetId: FleetId, hold: boolean): void {
    const error = game.issue({ type: "setHold", empireId: game.playerId, fleetId, hold });
    if (error) alert(error);
    update();
  }

  function focusFleet(fleetId: FleetId): void {
    const fleet = fleetView(fleetId);
    if (!fleet) return;
    selectTarget({ kind: "fleet", id: fleetId });
    map.centerOn(fleet.x, fleet.y);
  }

  function nextIdle(): void {
    const items = attentionItems(game.state, game.playerId);
    if (items.length === 0) return;
    const item = items[ui.idleCursor % items.length]!;
    ui.idleCursor++;
    focusFleet(item.fleetId);
  }

  function fleetStatus(fleet: FleetView): string {
    const pos = fleet.position;
    if (!fleet.own) {
      const where = pos.nextSystemId === null ? `at ${systemName(pos.systemId)}` : `between ${systemName(pos.systemId)} and ${systemName(pos.nextSystemId)}`;
      return fleet.seenTurn < view.turn ? `Last seen turn ${fleet.seenTurn}, ${where}` : `Sighted ${where}`;
    }
    if (fleet.route && fleet.route.length > 0) {
      const dest = fleet.route[fleet.route.length - 1]!;
      const plan = planMove(game.state, fleet.id, dest);
      return `To ${systemName(dest)} · ${typeof plan === "string" ? "?" : turnsText(plan.turns)}`;
    }
    return `${fleet.holding ? "Holding" : "Idle"} at ${systemName(pos.systemId)}`;
  }

  function describeEvent(e: GameEvent): string {
    switch (e.type) {
      case "fleetArrived":
        return `${fleetView(e.fleetId)?.name ?? "Fleet"} arrived at ${systemName(e.systemId)}`;
      case "systemExplored":
        return `Explored ${systemName(e.systemId)}`;
      case "fleetSighted":
        return `${empire(e.ownerId).name} fleet sighted near ${systemName(e.systemId)}`;
    }
  }

  // ---------- HUD pieces ----------

  function topBar(): HTMLElement {
    const me = empire(game.playerId);
    const explored = game.state.empires[game.playerId]!.explored.length;
    return h(
      "div",
      { className: "topbar" },
      h(
        "div",
        { className: "title" },
        `Turn ${view.turn}`,
        h("small", {}, h("span", { className: "swatch", style: `background:${me.color}` }), `${me.name} · ${explored}/${view.systems.length} explored`),
      ),
      button("Fleets", () => {
        ui.panel = ui.panel === "fleets" ? "none" : "fleets";
        update();
      }),
      button("⤢", () => map.fitGalaxy(), { ariaLabel: "Show whole galaxy" }),
      button("☰", () => {
        ui.panel = ui.panel === "menu" ? "none" : "menu";
        update();
      }, { ariaLabel: "Menu" }),
    );
  }

  function menuPanel(): HTMLElement {
    return h(
      "div",
      { className: "menu" },
      button("Export save file", () => download(`space4x-turn${game.state.turn}.json`, serializeSave(game))),
      button(ui.revealMap ? "Hide map (debug)" : "Reveal map (debug)", () => {
        ui.revealMap = !ui.revealMap;
        ui.panel = "none";
        update();
      }),
      button("New game…", () => {
        if (confirm("Start a new game? The current game will be replaced.")) {
          stopAutosave?.();
          void showSetup();
        }
      }),
      h("div", { className: "debug-note", textContent: `Seed: ${game.state.settings.seed}` }),
    );
  }

  function fleetsPanel(): HTMLElement {
    const list = h("ul");
    for (const fleet of view.fleets.filter((f) => f.own)) {
      const row = h("li", { className: "tappable" }, h("span", { textContent: fleet.name }), h("span", { textContent: fleetStatus(fleet) }));
      row.onclick = () => {
        ui.panel = "none";
        focusFleet(fleet.id);
      };
      list.append(row);
    }
    const rivals = view.fleets.filter((f) => !f.own);
    if (rivals.length > 0) {
      list.append(h("li", { className: "section" }, h("span", { textContent: "Known rival fleets" })));
      for (const fleet of rivals) {
        const row = h(
          "li",
          { className: "tappable" },
          h("span", {}, h("span", { className: "swatch", style: `background:${empire(fleet.empireId).color}` }), fleet.name),
          h("span", { textContent: fleetStatus(fleet) }),
        );
        row.onclick = () => {
          ui.panel = "none";
          focusFleet(fleet.id);
        };
        list.append(row);
      }
    }
    return h("div", { className: "sheet panel" }, h("h2", {}, "Fleets", button("✕", () => ((ui.panel = "none"), update()), { ariaLabel: "Close" })), list);
  }

  function contextMenu(): HTMLElement | null {
    const menu = ui.contextMenu;
    if (!menu) return null;
    const close = () => (ui.contextMenu = null);
    const items: HTMLButtonElement[] = [];
    const selected = fleetView(ui.selectedFleet);

    if (menu.target.kind === "system") {
      const id = menu.target.id;
      items.push(button("Details", () => selectTarget({ kind: "system", id })));
      if (selected?.own) {
        items.push(
          button(`Send ${selected.name} here`, () => {
            close();
            setPreview(selected.id, id);
            confirmPreview();
          }),
        );
      }
      items.push(button("Center here", () => (close(), map.centerOn(view.systems[id]!.x, view.systems[id]!.y), update())));
    } else {
      const fleet = fleetView(menu.target.id);
      if (fleet?.own) {
        items.push(button("Set destination", () => selectTarget({ kind: "fleet", id: fleet.id })));
        if (fleet.route?.length === 0) {
          items.push(button(fleet.holding ? "Stop holding" : "Hold here", () => (close(), setHold(fleet.id, !fleet.holding))));
        } else {
          items.push(button("Stop at next system", () => (close(), setPreview(fleet.id, fleet.route![0]!), confirmPreview())));
        }
      } else if (fleet) {
        items.push(button("Details", () => selectTarget({ kind: "fleet", id: fleet.id })));
      }
      if (fleet) items.push(button("Center here", () => (close(), map.centerOn(fleet.x, fleet.y), update())));
    }

    const width = 220;
    const left = Math.min(Math.max(menu.x - width / 2, 8), window.innerWidth - width - 8);
    const top = Math.min(menu.y + 16, window.innerHeight - 60 * items.length - 16);
    return h("div", { className: "menu context", style: `left:${left}px;top:${top}px;width:${width}px` }, ...items);
  }

  function previewBar(): HTMLElement | null {
    const preview = ui.preview;
    if (!preview) return null;
    const fleet = fleetView(preview.fleetId);
    const text = preview.route.length === 0 ? `${fleet?.name}: stay at ${systemName(preview.destinationId)}` : `${fleet?.name} → ${systemName(preview.destinationId)} · ${turnsText(preview.turns)}`;
    return h(
      "div",
      { className: "sheet confirm" },
      h("div", { className: "confirm-text", textContent: text }),
      h("div", { className: "row" }, button("Cancel", () => ((ui.preview = null), update())), button("Confirm", confirmPreview, { className: "primary" })),
    );
  }

  function fleetSheet(): HTMLElement | null {
    const fleet = fleetView(ui.selectedFleet);
    if (!fleet) return null;
    const owner = empire(fleet.empireId);
    const actions = h("div", { className: "row" });
    if (fleet.own) {
      if (fleet.route?.length === 0) actions.append(button(fleet.holding ? "Stop holding" : "Hold", () => setHold(fleet.id, !fleet.holding)));
      actions.append(button("Deselect", () => selectTarget(null)));
    }
    return h(
      "div",
      { className: "sheet" },
      h("h2", {}, h("span", {}, h("span", { className: "swatch", style: `background:${owner.color}` }), fleet.name), button("✕", () => selectTarget(null), { ariaLabel: "Close" })),
      h("div", { className: "sub", textContent: `${owner.name} · ${fleetStatus(fleet)}` }),
      fleet.own ? h("div", { className: "hint", textContent: "Tap a star to set a destination, or drag from the fleet." }) : null,
      fleet.own && fleet.speed ? h("div", { className: "hint", textContent: `Speed ${fleet.speed} per turn` }) : null,
      fleet.own ? actions : null,
    );
  }

  function systemSheet(): HTMLElement | null {
    if (ui.selectedSystem === null) return null;
    const system = view.systems[ui.selectedSystem]!;
    const star = pack.starTypes.find((t) => t.id === system.starType);
    const owner = system.homeOf === null ? null : empire(system.homeOf);

    const bodies = h("ul");
    if (!system.bodies) {
      bodies.append(h("li", {}, h("span", { className: "muted", textContent: "Unexplored. Send a fleet to survey it." })));
    } else if (system.bodies.length === 0) {
      bodies.append(h("li", {}, h("span", { textContent: "No bodies" })));
    } else {
      for (const body of system.bodies) {
        if (body.kind === "planet") {
          const type = pack.planetTypes.find((t) => t.id === body.planetType);
          const size = pack.planetSizes.find((t) => t.id === body.size);
          const rich = pack.richness.find((t) => t.id === body.richness);
          bodies.append(h("li", {}, h("span", { textContent: `${size?.name} ${type?.name} planet` }), h("span", { textContent: `${rich?.name} · hab ${type?.habitability}` })));
        } else {
          const label = { asteroids: "Asteroid field", gasGiant: "Gas giant", anomaly: "Anomaly" }[body.kind];
          bodies.append(h("li", {}, h("span", { textContent: label })));
        }
      }
    }

    const here = view.fleets.filter((f) => f.position.systemId === system.id && f.position.progress === 0);
    const fleets = h("ul");
    for (const fleet of here) {
      const row = h(
        "li",
        { className: "tappable" },
        h("span", {}, h("span", { className: "swatch", style: `background:${empire(fleet.empireId).color}` }), fleet.name),
        h("span", { textContent: fleet.own ? fleetStatus(fleet).split(" at ")[0]! : fleet.seenTurn < view.turn ? `seen turn ${fleet.seenTurn}` : empire(fleet.empireId).name }),
      );
      row.onclick = () => selectTarget({ kind: "fleet", id: fleet.id });
      fleets.append(row);
    }

    return h(
      "div",
      { className: "sheet" },
      h("h2", {}, system.name, button("✕", () => selectTarget(null), { ariaLabel: "Close" })),
      h("div", { className: "sub", textContent: `${star?.name ?? system.starType}${owner ? ` · ${owner.name} home` : ""}` }),
      bodies,
      here.length ? h("div", { className: "sub", style: "margin-top:10px", textContent: "Fleets" }) : null,
      here.length ? fleets : null,
    );
  }

  function reportSheet(): HTMLElement | null {
    if (!ui.report) return null;
    const mine = ui.report.filter((e) => e.empireId === game.playerId);
    const list = h("ul");
    for (const e of mine) {
      const row = h("li", { className: "tappable" }, h("span", { textContent: describeEvent(e) }));
      row.onclick = () => {
        const system = view.systems[e.systemId]!;
        if (e.type === "fleetArrived") return focusFleet(e.fleetId);
        if (e.type === "fleetSighted" && fleetView(e.fleetId)) return focusFleet(e.fleetId);
        selectTarget({ kind: "system", id: system.id });
        map.centerOn(system.x, system.y);
      };
      list.append(row);
    }
    if (mine.length === 0) list.append(h("li", {}, h("span", { className: "muted", textContent: "Nothing to report." })));
    return h("div", { className: "sheet" }, h("h2", {}, `Turn ${view.turn - 1} report`, button("✕", () => ((ui.report = null), update()), { ariaLabel: "Close report" })), list);
  }

  function bottomBar(): HTMLElement {
    const idle = attentionItems(game.state, game.playerId).length;
    const actions = h(
      "div",
      { className: "actions" },
      button("Undo", () => {
        game.undo();
        ui.preview = null;
        update();
      }, { disabled: !game.canUndo }),
      idle > 0 ? button(`${idle} idle ›`, nextIdle, { className: "attention", title: "Fleets without orders" }) : null,
      button("End turn", () => {
        ui.report = game.endTurn();
        ui.selectedSystem = null;
        ui.selectedFleet = null;
        ui.preview = null;
        ui.idleCursor = 0;
        void save();
        update();
      }, { className: "primary" }),
    );
    const sheet = previewBar() ?? fleetSheet() ?? systemSheet() ?? reportSheet();
    return h("div", { className: "bottombar" }, sheet, actions);
  }

  function update(): void {
    view = ui.revealMap ? omniscientView(game.state, game.playerId) : empireView(game.state, game.playerId);
    if (ui.selectedFleet !== null && !fleetView(ui.selectedFleet)) ui.selectedFleet = null;
    map.setScene({ view, selectedSystem: ui.selectedSystem, selectedFleet: ui.selectedFleet, preview: ui.preview });
    const overlays = [ui.panel === "menu" ? menuPanel() : null, ui.panel === "fleets" ? fleetsPanel() : null, contextMenu()].filter((x): x is HTMLElement => x !== null);
    hud.replaceChildren(topBar(), bottomBar(), ...overlays);
  }

  update();
  const home = view.systems[game.state.empires[game.playerId]!.homeSystemId]!;
  map.centerOn(home.x, home.y);
}

void showSetup();

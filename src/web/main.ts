import { Game, MAX_AI, MIN_AI, deserializeSave, serializeSave, type FleetId, type GameEvent, type GameSettings, type SystemId } from "../core";
import { defaultPack } from "../content/defaultPack";
import { onAppBackground } from "../platform/lifecycle";
import { LocalSaveStore } from "../platform/storage";
import { GalaxyMap } from "./map";

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

  const start = h("button", { className: "primary", textContent: "Start new game" });
  start.onclick = () => {
    const settings: GameSettings = { seed: seed.value.trim(), galaxySize: size.value, aiCount: Number(ai.value) };
    try {
      startGame(Game.create(settings, pack));
    } catch (e) {
      error.textContent = (e as Error).message;
    }
  };

  const reroll = h("button", { textContent: "Random", type: "button" });
  reroll.onclick = () => (seed.value = randomSeed());

  const importBtn = h("button", { textContent: "Import save file" });
  importBtn.onclick = async () => {
    const text = await pickFile();
    if (text) loadAndStart(text);
  };

  let continueBtn: HTMLButtonElement | null = null;
  if (saved) {
    continueBtn = h("button", { className: "primary", textContent: "Continue" });
    continueBtn.onclick = () => loadAndStart(saved);
  }

  root.append(
    h(
      "div",
      { className: "setup" },
      h("h1", { textContent: "Space 4X" }),
      h("p", { textContent: "Milestone 1 preview: galaxy generation and the turn loop." }),
      continueBtn,
      h("label", {}, "Galaxy seed", h("div", { className: "row" }, seed, reroll)),
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

function startGame(game: Game): void {
  stopAutosave?.();
  root.replaceChildren();

  let selectedSystem: SystemId | null = game.state.empires[0]!.homeSystemId;
  let selectedFleet: FleetId | null = null;
  /** When set, the next map tap picks this fleet's destination. */
  let movingFleet: FleetId | null = null;
  let report: GameEvent[] | null = null;
  let menuOpen = false;

  const save = () => store.write(AUTOSAVE, serializeSave(game)).catch(() => {});
  stopAutosave = onAppBackground(() => void save());
  void save();

  const map = new GalaxyMap(root, pack, (systemId) => {
    if (movingFleet !== null) {
      if (systemId !== null) {
        const error = game.issue({ type: "moveFleet", empireId: game.playerId, fleetId: movingFleet, destinationId: systemId });
        if (error) alert(error);
      }
      movingFleet = null;
    } else {
      selectedSystem = systemId;
      selectedFleet = null;
    }
    menuOpen = false;
    update();
  });

  const hud = h("div");
  root.append(hud);

  const systemName = (id: SystemId) => game.state.galaxy.systems[id]!.name;
  const empireName = (id: number) => game.state.empires[id]!.name;
  const fleetName = (id: FleetId) => game.state.fleets.find((f) => f.id === id)?.name ?? `Fleet ${id}`;

  function describeEvent(e: GameEvent): string {
    switch (e.type) {
      case "fleetArrived":
        return `${fleetName(e.fleetId)} arrived at ${systemName(e.systemId)}`;
      case "systemExplored":
        return `Explored ${systemName(e.systemId)}`;
    }
  }

  function topBar(): HTMLElement {
    const state = game.state;
    const explored = state.empires[0]!.explored.length;
    const menuBtn = h("button", { textContent: "☰", ariaLabel: "Menu" });
    menuBtn.onclick = () => {
      menuOpen = !menuOpen;
      update();
    };
    const fit = h("button", { textContent: "⤢", ariaLabel: "Show whole galaxy" });
    fit.onclick = () => map.fitGalaxy();
    return h(
      "div",
      { className: "topbar" },
      h("div", { className: "title" }, `Turn ${state.turn}`, h("small", { textContent: `${state.empires[0]!.name} · explored ${explored}/${state.galaxy.systems.length}` })),
      fit,
      menuBtn,
    );
  }

  function menu(): HTMLElement | null {
    if (!menuOpen) return null;
    const exportBtn = h("button", { textContent: "Export save file" });
    exportBtn.onclick = () => download(`space4x-turn${game.state.turn}.json`, serializeSave(game));
    const newBtn = h("button", { textContent: "New game…" });
    newBtn.onclick = () => {
      if (confirm("Start a new game? The current game will be replaced.")) {
        stopAutosave?.();
        void showSetup();
      }
    };
    const seed = h("div", { className: "debug-note", textContent: `Seed: ${game.state.settings.seed}` });
    return h("div", { className: "menu" }, exportBtn, newBtn, seed);
  }

  function systemSheet(): HTMLElement | null {
    if (selectedSystem === null) return null;
    const state = game.state;
    const system = state.galaxy.systems[selectedSystem]!;
    const star = pack.starTypes.find((t) => t.id === system.starType);
    const owner = state.empires.find((e) => e.homeSystemId === system.id);

    const close = h("button", { textContent: "✕", ariaLabel: "Close" });
    close.onclick = () => {
      selectedSystem = null;
      selectedFleet = null;
      update();
    };

    const bodies = h("ul");
    if (system.bodies.length === 0) bodies.append(h("li", {}, h("span", { textContent: "No bodies" })));
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

    const fleets = h("ul");
    const here = state.fleets.filter((f) => f.systemId === system.id && f.progress === 0);
    for (const fleet of here) {
      const empire = state.empires[fleet.empireId]!;
      const left = h("span", {}, h("span", { className: "swatch", style: `background:${empire.color}` }), fleet.name);
      let right: HTMLElement = h("span", { textContent: fleet.route.length ? `→ ${systemName(fleet.route[fleet.route.length - 1]!)}` : empire.name });
      if (fleet.empireId === game.playerId) {
        const moveBtn = h("button", { textContent: fleet.route.length ? "Redirect" : "Move" });
        moveBtn.onclick = () => {
          movingFleet = fleet.id;
          selectedFleet = fleet.id;
          update();
        };
        right = moveBtn;
      }
      fleets.append(h("li", {}, left, right));
    }

    return h(
      "div",
      { className: "sheet" },
      h("h2", {}, system.name, close),
      h("div", { className: "sub", textContent: `${star?.name ?? system.starType}${owner ? ` · ${owner.name} home` : ""}` }),
      bodies,
      here.length ? h("div", { className: "sub", style: "margin-top:10px", textContent: "Fleets" }) : null,
      here.length ? fleets : null,
    );
  }

  function reportSheet(): HTMLElement | null {
    if (!report) return null;
    const mine = report.filter((e) => e.empireId === game.playerId);
    const rivals = report.length - mine.length;
    const list = h("ul");
    for (const e of mine) list.append(h("li", {}, h("span", { textContent: describeEvent(e) })));
    if (mine.length === 0) list.append(h("li", {}, h("span", { textContent: "Nothing to report." })));
    if (rivals > 0) list.append(h("li", {}, h("span", { textContent: `Rival empires: ${rivals} events` })));
    const close = h("button", { textContent: "✕", ariaLabel: "Close report" });
    close.onclick = () => {
      report = null;
      update();
    };
    return h("div", { className: "sheet" }, h("h2", {}, `Turn ${game.state.turn - 1} report`, close), list);
  }

  function bottomBar(): HTMLElement {
    const actions = h("div", { className: "actions" });
    if (movingFleet !== null) {
      const cancel = h("button", { textContent: "Cancel" });
      cancel.onclick = () => {
        movingFleet = null;
        update();
      };
      actions.append(h("div", { className: "sheet", style: "flex:1;padding:10px 14px", textContent: `Tap a destination for ${fleetName(movingFleet)}` }), cancel);
      return h("div", { className: "bottombar" }, actions);
    }

    const undo = h("button", { textContent: "Undo", disabled: !game.canUndo });
    undo.onclick = () => {
      game.undo();
      update();
    };
    const endTurn = h("button", { className: "primary", textContent: "End turn" });
    endTurn.onclick = () => {
      report = game.endTurn();
      selectedSystem = null;
      selectedFleet = null;
      void save();
      update();
    };
    actions.append(undo, endTurn);
    return h(
      "div",
      { className: "bottombar" },
      reportSheet() ?? systemSheet(),
      actions,
      h("div", { className: "debug-note", textContent: "Preview build: no fog of war yet, AI scouts explore on their own." }),
    );
  }

  function update(): void {
    map.setState(game.state, { systemId: selectedSystem, fleetId: selectedFleet });
    hud.replaceChildren(topBar(), bottomBar(), ...[menu()].filter((x): x is HTMLElement => x !== null));
  }

  update();
}

void showSetup();

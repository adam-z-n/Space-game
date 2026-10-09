import {
  Game,
  MAX_AI,
  MIN_AI,
  attentionItems,
  bodyName,
  colonizeBlocker,
  colonyOnBody,
  deserializeSave,
  findColony,
  findFleet,
  fleetTroops,
  fleetShipStats,
  estimateOdds,
  fleetCanColonize,
  fleetStrength,
  getTech,
  prospectiveMaxPop,
  turnLimit,
  empireView,
  empireEffects,
  omniscientView,
  planMove,
  scrapValue,
  serializeSave,
  OUTPOST_KINDS,
  SABOTAGE_MISSIONS,
  outpostBlocker,
  outpostName,
  outpostTechOk,
  sabotageOdds,
  type ColonyId,
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
import { applyTheme } from "./theme";
import { spriteIcon } from "./sprites";
import { button, h, turnsText } from "./dom";
import { colonyPanel, empirePanel, gameOverPanel, queueEverywhere, researchPanel, resourceBar, type PanelContext } from "./economyPanels";
import { planetPlans, plannerLabels, plannerPanel, techTreePanel } from "./planningPanels";
import { battlePanel, designerPanel, designsPanel, fleetDetail, startDraft, type ShipContext } from "./shipPanels";

const AUTOSAVE = "autosave";
const pack = defaultPack();
applyTheme(pack);
const APP_VERSION = __APP_VERSION__;
const ARCHIVE = import.meta.env.VITE_ARCHIVE;
// Archived releases (served at /vX.Y/) keep their own saves, so playing an old
// version never upgrades or overwrites the save of the current one.
const store = new LocalSaveStore(ARCHIVE ? `space4x:v${ARCHIVE}:save:` : undefined);
const root = document.getElementById("app")!;

// ---------- helpers ----------

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
  const difficulty = h("select");
  for (const d of pack.difficulties) difficulty.append(h("option", { value: d.id, textContent: d.name, selected: d.id === "normal" }));
  const difficultyHint = h("div", { className: "hint" });
  const describeDifficulty = () => (difficultyHint.textContent = pack.difficulties.find((d) => d.id === difficulty.value)?.description ?? "");
  difficulty.onchange = describeDifficulty;
  describeDifficulty();
  const error = h("p", { className: "error", textContent: message ?? "" });

  // Empire picker: one card per playable empire, showing its species, traits and a ship in its colors.
  let chosen = 0;
  const empires = h("div", { className: "empire-grid" });
  const drawEmpires = () => {
    empires.replaceChildren(
      ...pack.empires.map((e, i) => {
        const species = pack.species.find((s) => s.id === e.species)!;
        const card = button("", () => {
          chosen = i;
          drawEmpires();
        }, { className: `empire-card${i === chosen ? " on" : ""}`, ariaPressed: String(i === chosen) });
        card.append(
          spriteIcon(pack, "frigate", e.color, 3),
          h("div", { className: "empire-name", textContent: e.name }),
          h("div", { className: "muted small", textContent: `${species.name}: ${species.description}` }),
          h("div", { className: "small trait", textContent: species.traits.join(" · ") }),
          h("div", {
            className: "muted small",
            textContent:
              species.research.access === "full"
                ? "Research: every school open"
                : `Research: one school per field; ${pack.researchFields.find((f) => f.id === species.research.affinity)?.name ?? "affinity"} +${species.research.affinityPercent}%, two schools`,
          }),
        );
        return card;
      }),
    );
  };
  drawEmpires();

  const start = button(
    "Start new game",
    () => {
      const settings: GameSettings = { seed: seed.value.trim(), galaxySize: size.value, aiCount: Number(ai.value), difficulty: difficulty.value, playerEmpire: chosen };
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
      h("div", { className: "title-art" }, spriteIcon(pack, "dreadnought", pack.presentation.colors.accent, 4)),
      h("h1", { textContent: "Space 4X" }),
      h("p", { className: "version" }, `Version ${APP_VERSION}`),
      ARCHIVE
        ? h("p", { className: "archive-note" }, "This is an archived version with its own saves. ", h("a", { href: "../", textContent: "Play the latest version" }))
        : null,
      h("p", { textContent: "A turn-based space empire game." }),
      saved ? button("Continue", () => loadAndStart(saved), { className: "primary" }) : null,
      h("h3", { textContent: "Choose your empire" }),
      empires,
      h("label", {}, "Galaxy seed", h("div", { className: "row" }, seed, button("Random", () => (seed.value = randomSeed()), { type: "button" }))),
      h("label", {}, "Galaxy size", size),
      h("label", {}, "AI empires", ai),
      h("label", {}, "Difficulty", difficulty, difficultyHint),
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
  panel: "none" | "menu" | "fleets" | "research" | "techtree" | "planner" | "empire" | "colony" | "designs" | "designer" | "battle" | "gameover";
  /** Show the colonization planner's planet values on the map. */
  showPlanetValues: boolean;
  /** Battle shown when panel is "battle", and the replay round. */
  battleId: number | null;
  battleRound: number;
  /** Colony shown when panel is "colony". */
  colonyId: ColonyId | null;
  contextMenu: { target: MapTarget; x: number; y: number } | null;
  revealMap: boolean;
  showSupply: boolean;
  /** The attention item the "to do" button showed last, so the next press moves on from it. */
  lastAttention: string | null;
}

function startGame(game: Game): void {
  stopAutosave?.();
  root.replaceChildren();

  // Resuming mid-game shows the last turn's report; a new game starts on the home system.
  const lastReport = game.state.lastTurnEvents.some((e) => e.empireId === game.playerId) ? game.state.lastTurnEvents : null;
  const ui: UiState = {
    selectedSystem: lastReport ? null : game.state.empires[game.playerId]!.homeSystemId,
    selectedFleet: null,
    preview: null,
    report: lastReport,
    panel: "none",
    colonyId: null,
    battleId: null,
    battleRound: 0,
    contextMenu: null,
    revealMap: false,
    showSupply: true,
    showPlanetValues: false,
    lastAttention: null,
  };

  const save = () => store.write(AUTOSAVE, serializeSave(game)).catch(() => {});
  stopAutosave = onAppBackground(() => void save());
  void save();

  let view: EmpireView = empireView(game.state, pack, game.playerId);
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

  const openPanel = (panel: UiState["panel"], colonyId: ColonyId | null = null) => {
    ui.panel = panel;
    ui.colonyId = colonyId;
    ui.contextMenu = null;
    update();
  };
  const ctx: PanelContext = {
    game,
    pack,
    issue: (command) => {
      const error = game.issue(command);
      if (error) alert(error);
      update();
      return error === null;
    },
    openColony: (colonyId) => openPanel("colony", colonyId),
    openResearch: () => openPanel("research"),
    openTechTree: () => openPanel("techtree"),
    openEmpire: () => openPanel("empire"),
    close: () => openPanel("none"),
    refresh: () => update(),
    newGame: () => {
      stopAutosave?.();
      void showSetup();
    },
  };
  const shipCtx: ShipContext = {
    game,
    pack,
    issue: ctx.issue,
    rerender: () => update(),
    newDesign: (base) => {
      startDraft(pack, game.state.empires[game.playerId]!, base);
      openPanel("designer");
    },
    openDesigner: () => openPanel("designer"),
    openDesigns: () => openPanel("designs"),
    close: () => openPanel("none"),
    empireName: (id) => empire(id).name,
    empireColor: (id) => empire(id).color,
    systemName: (id) => systemName(id),
    // Ships you fought were seen up close, so their hulls can be shown; defenses have no sprite.
    hullOf: (_shipId, empireId, designName) => game.state.empires[empireId]?.designs.find((d) => d.name === designName)?.hull ?? null,
  };
  const openBattle = (battleId: number) => {
    ui.battleId = battleId;
    ui.battleRound = 0;
    openPanel("battle");
  };

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

  /** Step through things that need a decision: research, empty queues, colony ships, idle fleets. */
  function nextAttention(): void {
    const items = attentionItems(game.state, pack, game.playerId);
    if (items.length === 0) return;
    const key = (i: (typeof items)[number]) => JSON.stringify(i);
    const last = items.findIndex((i) => key(i) === ui.lastAttention);
    const item = items[(last + 1) % items.length]!;
    ui.lastAttention = key(item);
    switch (item.type) {
      case "chooseResearch":
        return openPanel("research");
      case "emptyQueue": {
        const system = view.systems[item.systemId]!;
        map.centerOn(system.x, system.y);
        ui.selectedSystem = system.id;
        ui.selectedFleet = null;
        return openPanel("colony", item.colonyId);
      }
      case "canColonize":
      case "idleFleet":
        ui.panel = "none";
        return focusFleet(item.fleetId);
    }
  }

  /** Planets in a system that one of the player's colony ships there could settle right now. */
  function colonizeOptions(systemId: SystemId): { fleetId: FleetId; bodyId: number; name: string; maxPop: number }[] {
    const empireState = game.state.empires[game.playerId]!;
    const ships = game.state.fleets.filter(
      (f) => f.empireId === game.playerId && f.systemId === systemId && f.progress === 0 && fleetCanColonize(pack, game.state, f),
    );
    if (ships.length === 0) return [];
    const system = game.state.galaxy.systems[systemId]!;
    return system.bodies
      .filter((b) => !colonyOnBody(game.state, b.id) && colonizeBlocker(pack, empireState, b) === null)
      .map((b) => ({ fleetId: ships[0]!.id, bodyId: b.id, name: bodyName(system, b.id), maxPop: prospectiveMaxPop(pack, empireState, b) }));
  }

  function colonize(fleetId: FleetId, bodyId: number): void {
    if (ctx.issue({ type: "colonize", empireId: game.playerId, fleetId, bodyId })) {
      const colony = colonyOnBody(game.state, bodyId);
      ui.selectedFleet = null;
      if (colony) {
        ui.selectedSystem = colony.systemId;
        openPanel("colony", colony.id);
      }
    }
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
      case "colonySighted":
        return `Found a ${empire(e.ownerId).name} colony at ${systemName(e.systemId)}`;
      case "colonyFounded":
        return `New colony at ${systemName(e.systemId)}`;
      case "buildingCompleted":
        return `${pack.buildings.find((b) => b.id === e.buildingId)?.name} built at ${colonyName(e.colonyId)}`;
      case "shipCompleted":
        return `${fleetView(e.fleetId)?.name ?? "Ship"} launched at ${colonyName(e.colonyId)}`;
      case "techResearched":
        return `Researched ${getTech(pack, e.techId).name}`;
      case "techCaptured":
        return `Captured the secrets of ${getTech(pack, e.techId).name} from the ${empire(e.fromEmpireId).name}`;
      case "populationGrew":
        return `${colonyName(e.colonyId)} grew to ${e.population}`;
      case "starvation":
        return "Food ran out: colonies are starving";
      case "inDebt":
        return `Treasury in debt (${e.credits}): industry and research reduced`;
      case "battle":
        return `Battle at ${systemName(e.systemId)}: ${e.outcome === "won" ? "victory" : e.outcome === "lost" ? "defeat" : "inconclusive"}`;
      case "outOfSupply":
        return `${fleetView(e.fleetId)?.name ?? "A fleet"} ran out of supply near ${systemName(e.systemId)}`;
      case "attrition":
        return `${e.shipsLost} ship${e.shipsLost > 1 ? "s" : ""} lost to attrition near ${systemName(e.systemId)}`;
      case "fleetIntercepted":
        return `${fleetView(e.fleetId)?.name ?? "A fleet"} was stopped by enemies at ${systemName(e.systemId)}`;
      case "blockaded":
        return `${colonyName(e.colonyId)} is blockaded: no supply or trade`;
      case "invasion": {
        const mine = e.attackerId === game.playerId;
        const name = colonyName(e.colonyId);
        if (mine) return e.captured ? `Captured ${name}! (${e.attackingTroops} troops vs ${e.defendingTroops})` : `Invasion of ${name} repelled (${e.attackingTroops} troops vs ${e.defendingTroops})`;
        return e.captured ? `${empire(e.attackerId).name} captured ${name}` : `Repelled ${empire(e.attackerId).name}'s landing on ${name}`;
      }
      case "defensesDown":
        return `${colonyName(e.colonyId)}'s orbital defenses are down`;
      case "mineHits":
        return `Mines hit ${e.hits} ship${e.hits > 1 ? "s" : ""} near ${systemName(e.systemId)}${e.shipsLost ? `, ${e.shipsLost} lost` : ""}`;
      case "capitalMoved":
        return `Capital moved to ${colonyName(e.colonyId)}`;
      case "outpostLost":
        return `Lost a ${pack.outposts[e.kind].name} at ${systemName(e.systemId)}`;
      case "sabotage": {
        const what = { defenses: "orbital defenses", garrison: "garrison", buildings: "buildings" }[e.mission];
        if (e.attackerId === game.playerId) return e.success ? `Commandos struck ${colonyName(e.colonyId)}'s ${what}` : `Commandos caught at ${colonyName(e.colonyId)}: a ship was lost`;
        return e.success ? `Saboteurs struck ${colonyName(e.colonyId)}'s ${what}` : `Caught saboteurs at ${colonyName(e.colonyId)}`;
      }
      case "bombarded": {
        const lost = `${e.populationLost} population${e.buildingLost ? ` and its ${pack.buildings.find((b) => b.id === e.buildingLost)?.name}` : ""}`;
        return e.attackerId === game.playerId ? `Bombarded ${colonyName(e.colonyId)}: ${lost} lost` : `${empire(e.attackerId).name} bombarded ${colonyName(e.colonyId)}: ${lost} lost`;
      }
      case "empireEliminated":
        return e.eliminatedId === game.playerId ? "Your empire has fallen" : `${empire(e.eliminatedId).name} has been eliminated`;
      case "gameOver":
        return e.winnerId === game.playerId ? "Victory!" : `${empire(e.winnerId).name} has won the game`;
    }
  }

  const colonyName = (id: ColonyId) => findColony(game.state, id)?.name ?? "a colony";

  /** Where tapping a report line should take the player. */
  function openEvent(e: GameEvent): void {
    switch (e.type) {
      case "techResearched":
      case "techCaptured":
        return openPanel("research");
      case "starvation":
      case "inDebt":
        return openPanel("empire");
      case "buildingCompleted":
      case "populationGrew":
        return openPanel("colony", e.colonyId);
      case "shipCompleted":
      case "fleetArrived":
        return focusFleet(e.fleetId);
      case "fleetSighted":
      case "outOfSupply":
      case "fleetIntercepted":
        if (fleetView(e.fleetId)) return focusFleet(e.fleetId);
        break;
      case "battle":
        return openBattle(e.battleId);
      case "empireEliminated":
        return openPanel("empire");
      case "gameOver":
        return openPanel("gameover");
    }
    const system = view.systems[e.systemId]!;
    selectTarget({ kind: "system", id: system.id });
    map.centerOn(system.x, system.y);
  }

  // ---------- HUD pieces ----------

  function topBar(): HTMLElement {
    const me = empire(game.playerId);
    const explored = game.state.empires[game.playerId]!.explored.length;
    const bar = h(
      "div",
      { className: "topbar-row" },
      h(
        "div",
        { className: "title" },
        `Turn ${view.turn}/${turnLimit(game.state, pack)}`,
        h("small", {}, h("span", { className: "swatch", style: `background:${me.color}` }), `${me.name} · ${explored}/${view.systems.length} explored`),
      ),
      button("Fleets", () => openPanel(ui.panel === "fleets" ? "none" : "fleets")),
      button("⤢", () => map.fitGalaxy(), { ariaLabel: "Show whole galaxy" }),
      button("☰", () => openPanel(ui.panel === "menu" ? "none" : "menu"), { ariaLabel: "Menu" }),
    );
    return h("div", { className: "topbar" }, bar, resourceBar(ctx));
  }

  /** Close panels and show a system on the map. */
  function locateSystem(systemId: SystemId): void {
    const system = view.systems[systemId]!;
    ui.panel = "none";
    selectTarget({ kind: "system", id: systemId });
    map.centerOn(system.x, system.y);
  }

  function menuPanel(): HTMLElement {
    return h(
      "div",
      { className: "menu" },
      button("Ship designs", () => openPanel("designs")),
      button("Research tree", () => openPanel("techtree")),
      button("Colonization planner", () => openPanel("planner")),
      button(ui.showSupply ? "Hide resupply points" : "Show resupply points", () => {
        ui.showSupply = !ui.showSupply;
        openPanel("none");
      }),
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
      h("div", { className: "debug-note", textContent: `Version ${APP_VERSION}${ARCHIVE ? " (archived)" : ""} · seed ${game.state.settings.seed}` }),
    );
  }

  function fleetsPanel(): HTMLElement {
    const list = h("ul");
    for (const fleet of view.fleets.filter((f) => f.own)) {
      const dry = fleet.supply === 0 ? " ⚠" : "";
      const row = h("li", { className: "tappable" }, h("span", { textContent: `${fleet.name}${fleet.ships > 1 ? ` (${fleet.ships})` : ""}${dry}` }), h("span", { textContent: fleetStatus(fleet) }));
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
          h("span", {}, h("span", { className: "swatch", style: `background:${empire(fleet.empireId).color}` }), `${fleet.name} (${fleet.ships}${fleet.armed ? ` · str ${fleet.strength}` : ""})`),
          h("span", { textContent: fleetStatus(fleet) }),
        );
        row.onclick = () => {
          ui.panel = "none";
          focusFleet(fleet.id);
        };
        list.append(row);
      }
    }
    return h(
      "div",
      { className: "sheet panel" },
      h("h2", {}, "Fleets", button("✕", () => ((ui.panel = "none"), update()), { ariaLabel: "Close" })),
      button("Ship designs", () => openPanel("designs")),
      list,
    );
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
    const own = findFleet(game.state, preview.fleetId);
    const odds = own && preview.route.length > 0 ? estimateOdds(view, fleetStrength(pack, game.state, own), preview.route) : null;
    const oddsLine = odds ? oddsText(odds, own ? fleetStrength(pack, game.state, own) : 0) : null;
    return h(
      "div",
      { className: "sheet confirm" },
      h("div", { className: "confirm-text", textContent: text }),
      oddsLine,
      h("div", { className: "row" }, button("Cancel", () => ((ui.preview = null), update())), button("Confirm", confirmPreview, { className: "primary" })),
    );
  }

  function oddsText(odds: ReturnType<typeof estimateOdds>, ownStrength: number): HTMLElement {
    const parts: string[] = [];
    const age = odds.intelAge ? ` (intel ${odds.intelAge} turn${odds.intelAge > 1 ? "s" : ""} old)` : "";
    switch (odds.verdict) {
      case "unopposed":
        parts.push("No enemy warships seen there.");
        break;
      case "unknown":
        parts.push("Outside sensor range: no current intel.");
        break;
      default:
        parts.push(`Odds ${odds.verdict}: your strength ${ownStrength} vs ~${odds.enemyStrength}${age}.`);
    }
    if (odds.blockedAt.length) parts.push(`Enemy warships at ${odds.blockedAt.map(systemName).join(", ")} will stop you on the way.`);
    const cls = odds.verdict === "unfavorable" || odds.blockedAt.length ? "warn-text small" : "muted small";
    return h("div", { className: cls, textContent: parts.join(" ") });
  }

  /** Invade buttons for a troop-carrying fleet at, or heading to, a known rival colony. */
  /** Bombard controls for a fleet with bomb bays at (or heading for) a rival colony. */
  function bombardControls(fleet: FleetView): HTMLElement | null {
    const real = findFleet(game.state, fleet.id);
    if (!real) return null;
    const stats = fleetShipStats(pack, game.state, real);
    const power = stats.reduce((n, s) => n + s.bombard, 0);
    if (power === 0) return null;
    const where = real.route.length > 0 ? real.route[real.route.length - 1]! : real.systemId;
    const targets = view.systems[where]!.colonies.filter((c) => !c.own);
    if (targets.length === 0) return null;
    const box = h("div", { className: "column" }, h("div", { className: "small", textContent: `Bombs: ${power} damage a turn` }));
    const pending = targets.find((c) => c.colonyId === real.bombardColonyId);
    if (pending) {
      box.append(
        h("div", { className: "warn-text small", textContent: `Bombarding ${pending.name} each turn its orbital defenses are down.` }),
        button("Stop bombardment", () => ctx.issue({ type: "bombard", empireId: game.playerId, fleetId: real.id, colonyId: null })),
      );
    } else {
      for (const c of targets) box.append(button(`Bombard ${c.name}`, () => ctx.issue({ type: "bombard", empireId: game.playerId, fleetId: real.id, colonyId: c.colonyId })));
    }
    return box;
  }

  /** Commando raids for a fleet carrying special forces at (or heading for) a rival colony. */
  function sabotageControls(fleet: FleetView): HTMLElement | null {
    const real = findFleet(game.state, fleet.id);
    if (!real) return null;
    const stats = fleetShipStats(pack, game.state, real);
    const commandos = stats.reduce((n, s) => n + s.commandos, 0);
    if (commandos === 0) return null;
    const cloaked = stats.every((s) => s.stealth);
    const where = real.route.length > 0 ? real.route[real.route.length - 1]! : real.systemId;
    const targets = view.systems[where]!.colonies.filter((c) => !c.own);
    const box = h(
      "div",
      { className: "column" },
      h("div", { className: "small", textContent: `${commandos} commando team${commandos > 1 ? "s" : ""}${cloaked ? " · cloaked: hard to see, slips past blockades" : ""}` }),
    );
    const labels = { defenses: "defenses", garrison: "garrison", buildings: "a building" } as const;
    const pending = real.sabotage ? targets.find((c) => c.colonyId === real.sabotage!.colonyId) : undefined;
    if (pending && real.sabotage) {
      box.append(
        h("div", { className: "warn-text small", textContent: `Sabotaging ${pending.name}'s ${labels[real.sabotage.mission]} each turn in orbit.` }),
        button("Call off", () => ctx.issue({ type: "sabotage", empireId: game.playerId, fleetId: real.id, colonyId: null, mission: "defenses" })),
      );
      return box;
    }
    for (const c of targets) {
      // Odds from the defenders the player last saw.
      const odds = sabotageOdds(commandos, c.troops, empireEffects(pack, game.state.empires[game.playerId]!).sabotagePercent);
      for (const mission of SABOTAGE_MISSIONS) {
        box.append(button(`Sabotage ${c.name}: ${labels[mission]} (~${odds}%)`, () => ctx.issue({ type: "sabotage", empireId: game.playerId, fleetId: real.id, colonyId: c.colonyId, mission })));
      }
    }
    return targets.length > 0 || cloaked ? box : null;
  }

  function invasionControls(fleet: FleetView): HTMLElement | null {
    const real = findFleet(game.state, fleet.id);
    if (!real) return null;
    const troops = fleetTroops(game.state, pack, real);
    if (troops === 0) return null;
    const where = real.route.length > 0 ? real.route[real.route.length - 1]! : real.systemId;
    const targets = view.systems[where]!.colonies.filter((c) => !c.own);
    const box = h("div", { className: "column" }, h("div", { className: "small", textContent: `Carrying ${troops} ground troops` }));
    const pending = targets.find((c) => c.colonyId === real.invadeColonyId);
    if (pending) {
      box.append(
        h("div", { className: "warn-text small", textContent: `Will land on ${pending.name} once its orbital defenses are down (defenders ~${pending.troops}).` }),
        button("Cancel invasion", () => ctx.issue({ type: "invade", empireId: game.playerId, fleetId: real.id, colonyId: null })),
      );
    } else {
      for (const c of targets) {
        const odds = troops > c.troops * 1.3 ? "good odds" : troops > c.troops ? "close" : "likely to fail";
        box.append(button(`Invade ${c.name} · ${troops} vs ~${c.troops} (${odds})`, () => ctx.issue({ type: "invade", empireId: game.playerId, fleetId: real.id, colonyId: c.colonyId }), { className: "primary" }));
      }
    }
    return box;
  }

  function fleetSheet(): HTMLElement | null {
    const fleet = fleetView(ui.selectedFleet);
    if (!fleet) return null;
    const owner = empire(fleet.empireId);
    const actions = h("div", { className: "row" });
    if (fleet.own) {
      if (fleet.route?.length === 0) actions.append(button(fleet.holding ? "Stop holding" : "Hold", () => setHold(fleet.id, !fleet.holding)));
      actions.append(button("Deselect", () => selectTarget(null)));
      actions.append(
        button("Rename", () => {
          const name = prompt("Fleet name", fleet.name);
          if (name !== null && name.trim() && name.trim() !== fleet.name) ctx.issue({ type: "renameFleet", empireId: game.playerId, fleetId: fleet.id, name: name.trim() });
        }),
      );
      actions.append(
        button("Disband", () => {
          const refund = scrapValue(game.state, pack, findFleet(game.state, fleet.id)!);
          const refundText = refund > 0 ? `You get ${refund} credits back for the parts.` : "Outside supply, nothing can be salvaged.";
          if (confirm(`Scrap ${fleet.name}? Its upkeep stops. ${refundText}`)) {
            ctx.issue({ type: "disbandFleet", empireId: game.playerId, fleetId: fleet.id });
            selectTarget(null);
          }
        }, { className: "danger" }),
      );
    }
    const settle = fleet.own && fleet.position.progress === 0 ? colonizeOptions(fleet.position.systemId).filter((o) => o.fleetId === fleet.id) : [];
    const settleRow = settle.length
      ? h("div", { className: "column" }, ...settle.map((o) => button(`Colonize ${o.name} · max pop ${o.maxPop}`, () => colonize(o.fleetId, o.bodyId), { className: "primary" })))
      : null;
    const invasion = fleet.own ? invasionControls(fleet) : null;
    const bombing = fleet.own ? bombardControls(fleet) : null;
    const commandos = fleet.own ? sabotageControls(fleet) : null;
    const intel = fleet.own ? null : h("div", { className: "muted small", textContent: `${fleet.ships} ship${fleet.ships > 1 ? "s" : ""}${fleet.armed ? ` · strength ~${fleet.strength}` : " · unarmed"}` });
    return h(
      "div",
      { className: "sheet" },
      h("h2", {}, h("span", {}, h("span", { className: "swatch", style: `background:${owner.color}` }), fleet.name), button("✕", () => selectTarget(null), { ariaLabel: "Close" })),
      h("div", { className: "sub", textContent: `${owner.name} · ${fleetStatus(fleet)}` }),
      intel,
      settleRow,
      invasion,
      bombing,
      commandos,
      fleet.own ? fleetDetail(shipCtx, fleet.id) : null,
      fleet.own ? h("div", { className: "hint", textContent: "Tap a star to set a destination, or drag from the fleet." }) : null,
      fleet.own ? actions : null,
    );
  }

  /** Buttons for building outposts on a body with an own outpost ship stopped in its system. */
  function outpostBuilders(systemId: SystemId, bodyId: number): HTMLElement[] {
    const body = game.state.galaxy.systems[systemId]!.bodies.find((b) => b.id === bodyId);
    if (!body || body.kind === "planet") return [];
    const builder = game.state.fleets.find(
      (f) => f.empireId === game.playerId && f.systemId === systemId && f.progress === 0 && fleetShipStats(pack, game.state, f).some((s) => s.outpost),
    );
    if (!builder) return [];
    const me = game.state.empires[game.playerId]!;
    return OUTPOST_KINDS.filter((kind) => outpostBlocker(game.state, pack, me, body, kind) === null).map((kind) =>
      button(`Build ${pack.outposts[kind].name}`, () => ctx.issue({ type: "buildOutpost", empireId: game.playerId, fleetId: builder.id, bodyId, kind }), {
        className: "primary small-button",
        title: pack.outposts[kind].description,
      }),
    );
  }

  function systemSheet(): HTMLElement | null {
    if (ui.selectedSystem === null) return null;
    const system = view.systems[ui.selectedSystem]!;
    const star = pack.starTypes.find((t) => t.id === system.starType);
    const capitalOf = system.colonies.find((c) => c.capital);
    const settle = new Map(colonizeOptions(system.id).map((o) => [o.bodyId, o]));

    const bodies = h("ul");
    if (!system.bodies) {
      bodies.append(h("li", {}, h("span", { className: "muted", textContent: "Unexplored. Send a fleet to survey it." })));
    } else if (system.bodies.length === 0) {
      bodies.append(h("li", {}, h("span", { textContent: "No bodies" })));
    } else {
      for (const body of system.bodies) {
        const colony = system.colonies.find((c) => c.bodyId === body.id);
        let label: string;
        let detail: HTMLElement;
        if (body.kind === "planet") {
          const type = pack.planetTypes.find((t) => t.id === body.planetType);
          const size = pack.planetSizes.find((t) => t.id === body.size);
          const rich = pack.richness.find((t) => t.id === body.richness);
          label = `${size?.name} ${type?.name}`;
          detail = h("span", { textContent: `${rich?.name} · hab ${type?.habitability}` });
        } else {
          label = { asteroids: "Asteroid field", gasGiant: "Gas giant", anomaly: "Anomaly" }[body.kind];
          detail = h("span", { textContent: "" });
        }
        const row = h("li", {}, h("span", {}, label));
        if (colony) {
          const owner = empire(colony.empireId);
          const stale = !colony.own && colony.seenTurn < view.turn ? ` (turn ${colony.seenTurn})` : "";
          row.firstChild!.appendChild(
            h("div", { className: "small" }, h("span", { className: "swatch", style: `background:${owner.color}` }), `${colony.capital ? "★ " : ""}${colony.name} · pop ${colony.population}${stale}`),
          );
          row.firstChild!.appendChild(
            h("div", { className: "muted small", textContent: `${colony.defenseHp > 0 ? `defenses ${colony.defenseHp} hp` : "defenses down"} · ~${colony.troops} troops${colony.blockaded ? " · blockaded" : ""}` }),
          );
          if (colony.own) {
            row.className = "tappable";
            row.onclick = () => openPanel("colony", colony.colonyId);
            detail = h("span", { textContent: "Manage ›" });
          }
        }
        const outpost = system.outposts.find((o) => o.bodyId === body.id);
        if (outpost) {
          const real = game.state.outposts.find((o) => o.id === outpost.id);
          const name = real ? outpostName(pack, real) : pack.outposts[outpost.kind].name;
          row.firstChild!.appendChild(
            h("div", { className: "small" }, h("span", { className: "swatch", style: `background:${empire(outpost.empireId).color}` }), `${name}${outpost.kind === "combat" ? ` · ${outpost.defenseHp} hp` : ""}`),
          );
          if (outpost.own && outpost.kind === "combat" && !outpost.depot && outpostTechOk(pack, game.state.empires[game.playerId]!, "depot")) {
            detail = button(`Make depot · ${pack.outposts.depot.cost} ¢`, () => ctx.issue({ type: "upgradeOutpost", empireId: game.playerId, outpostId: outpost.id }), { className: "small-button", title: pack.outposts.depot.description });
          }
        }
        const builders = outpostBuilders(system.id, body.id);
        const option = settle.get(body.id);
        row.append(
          option
            ? button(`Colonize · max ${option.maxPop}`, () => colonize(option.fleetId, option.bodyId), { className: "primary small-button" })
            : builders.length
              ? h("span", { className: "column" }, ...builders)
              : detail,
        );
        bodies.append(row);
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
      h("div", { className: "sub", textContent: `${star?.name ?? system.starType}${capitalOf ? ` · ${empire(capitalOf.empireId).name} capital` : ""}` }),
      bodies,
      here.length ? h("div", { className: "sub", style: "margin-top:10px", textContent: "Fleets" }) : null,
      here.length ? fleets : null,
    );
  }

  function reportSheet(): HTMLElement | null {
    if (!ui.report) return null;
    const mine = ui.report.filter((e) => e.empireId === game.playerId);
    // Growth is frequent: fold it into one line when several colonies grew.
    const grew = mine.filter((e) => e.type === "populationGrew");
    const shown = grew.length > 2 ? mine.filter((e) => e.type !== "populationGrew") : mine;
    const list = h("ul");
    for (const e of shown) {
      const row = h("li", { className: "tappable" }, h("span", { textContent: describeEvent(e) }));
      row.onclick = () => openEvent(e);
      list.append(row);
      // A tech that unlocks a building: offer to queue it at every colony in one tap.
      if (e.type === "techResearched") {
        for (const offer of queueEverywhere(ctx, e.techId)) list.append(h("li", {}, offer));
      }
    }
    if (grew.length > 2) {
      const row = h("li", { className: "tappable" }, h("span", { textContent: `${grew.length} colonies grew` }));
      row.onclick = () => openPanel("empire");
      list.append(row);
    }
    if (mine.length === 0) list.append(h("li", {}, h("span", { className: "muted", textContent: "Nothing to report." })));
    return h("div", { className: "sheet" }, h("h2", {}, `Turn ${view.turn - 1} report`, button("✕", () => ((ui.report = null), update()), { ariaLabel: "Close report" })), list);
  }

  function bottomBar(): HTMLElement {
    const todo = attentionItems(game.state, pack, game.playerId).length;
    const actions = h(
      "div",
      { className: "actions" },
      button("Undo", () => {
        game.undo();
        ui.preview = null;
        update();
      }, { disabled: !game.canUndo }),
      todo > 0 ? button(`${todo} to do ›`, nextAttention, { className: "attention", title: "Research, build queues and fleets waiting for orders" }) : null,
      game.state.outcome
        ? button("Results", () => openPanel("gameover"), { className: "primary" })
        : button("End turn", () => {
        ui.report = game.endTurn();
        ui.selectedSystem = null;
        ui.selectedFleet = null;
        ui.preview = null;
        ui.lastAttention = null;
        ui.panel = game.state.outcome ? "gameover" : "none";
        void save();
        update();
      }, { className: "primary" }),
    );
    // A full panel replaces the bottom sheet; the preview bar always shows.
    const sheet = previewBar() ?? (ui.panel === "none" || ui.panel === "menu" ? (fleetSheet() ?? systemSheet() ?? reportSheet()) : null);
    return h("div", { className: "bottombar" }, sheet, actions);
  }

  function battleView(): HTMLElement | null {
    const report = view.battles.find((b) => b.id === ui.battleId);
    if (!report) return null;
    return battlePanel(shipCtx, report, ui.battleRound, (round) => {
      ui.battleRound = round;
      update();
    });
  }

  function update(): void {
    view = ui.revealMap ? omniscientView(game.state, pack, game.playerId) : empireView(game.state, pack, game.playerId);
    if (ui.selectedFleet !== null && !fleetView(ui.selectedFleet)) ui.selectedFleet = null;
    const annotations = ui.showPlanetValues ? plannerLabels(planetPlans(game.state, pack, view, game.state.empires[game.playerId]!), pack) : undefined;
    map.setScene({ view, selectedSystem: ui.selectedSystem, selectedFleet: ui.selectedFleet, preview: ui.preview, showSupply: ui.showSupply, annotations });
    const panel =
      ui.panel === "menu"
        ? menuPanel()
        : ui.panel === "fleets"
          ? fleetsPanel()
          : ui.panel === "research"
            ? researchPanel(ctx)
            : ui.panel === "techtree"
              ? techTreePanel(ctx)
              : ui.panel === "planner"
                ? plannerPanel(ctx, view, locateSystem, ui.showPlanetValues, () => {
                    ui.showPlanetValues = !ui.showPlanetValues;
                    update();
                  })
            : ui.panel === "empire"
              ? empirePanel(ctx)
              : ui.panel === "colony" && ui.colonyId !== null
                ? colonyPanel(ctx, ui.colonyId)
                : ui.panel === "designs"
                  ? designsPanel(shipCtx)
                  : ui.panel === "designer"
                    ? designerPanel(shipCtx)
                    : ui.panel === "battle"
                      ? battleView()
                      : ui.panel === "gameover"
                        ? gameOverPanel(ctx)
                        : null;
    const overlays = [panel, contextMenu()].filter((x): x is HTMLElement => x !== null);
    hud.replaceChildren(topBar(), bottomBar(), ...overlays);
  }

  update();
  const home = view.systems[game.state.empires[game.playerId]!.homeSystemId]!;
  map.centerOn(home.x, home.y);
}

void showSetup();

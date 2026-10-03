import { describe, expect, it } from "vitest";
import {
  Game,
  allocateWorkers,
  applyCommand,
  attentionItems,
  buyCost,
  colonyOutput,
  createInitialState,
  empireEconomy,
  empireView,
  maxPopulation,
  queueForecast,
  type Colony,
  type Command,
  type GameState,
} from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();

function fresh(): GameState {
  return createInitialState({ seed: "economy", galaxySize: "small", aiCount: 2 }, pack);
}

function run(state: GameState, ...commands: Command[]): GameState {
  for (const command of commands) {
    const result = applyCommand(state, command, pack);
    if (!result.ok) throw new Error(`${command.type}: ${result.error}`);
    state = result.state;
  }
  return state;
}

const end: Command = { type: "endTurn" };
const capital = (s: GameState, empireId = 0): Colony => s.colonies.find((c) => c.empireId === empireId && c.capital)!;

describe("starting position", () => {
  it("gives every empire a capital, starting fleets and treasury", () => {
    const s = fresh();
    for (const empire of s.empires) {
      const cap = capital(s, empire.id);
      expect(cap).toMatchObject({ systemId: empire.homeSystemId, population: pack.economy.capitalPopulation, buildings: ["capitol"] });
      expect(s.fleets.filter((f) => f.empireId === empire.id).map((f) => f.templateId)).toEqual(["scout", "frigate", "colony_ship"]);
      expect(empire.credits).toBe(pack.economy.startingCredits);
    }
  });

  it("names ships per template", () => {
    expect(fresh().fleets.filter((f) => f.empireId === 0).map((f) => f.name)).toEqual(["Scout 1", "Frigate 1", "Colony Ship 1"]);
  });
});

describe("workers and output", () => {
  it("feeds the colony first, then follows the focus", () => {
    expect(allocateWorkers(5, "balanced", 3, 1)).toEqual({ farmers: 2, industry: 2, research: 1 });
    expect(allocateWorkers(5, "industry", 3, 1)).toEqual({ farmers: 2, industry: 3, research: 0 });
    expect(allocateWorkers(5, "research", 3, 1)).toEqual({ farmers: 2, industry: 0, research: 3 });
    expect(allocateWorkers(5, "food", 3, 1)).toEqual({ farmers: 5, industry: 0, research: 0 });
    // Barren worlds can't farm: everyone works, the empire's food stock feeds them.
    expect(allocateWorkers(3, "balanced", 0, 1)).toEqual({ farmers: 0, industry: 2, research: 1 });
    expect(allocateWorkers(3, "food", 0, 1)).toEqual({ farmers: 0, industry: 3, research: 0 });
  });

  it("computes the capital's output from workers, capitol and planet", () => {
    const s = fresh();
    const out = colonyOutput(s, pack, capital(s));
    // 5 pop balanced on a terran world: 2 farmers, 2 industry, 1 research; base industry 2;
    // capitol +2 industry, +2 research, +3 credits, +3 food; tax is half a credit per pop.
    expect(out).toMatchObject({ industry: 2 * 3 + 2 + 2, research: 1 * 3 + 2, food: 2 * 3 + 3, foodEaten: 5, credits: 2 + 3, maxPop: 8 });
  });

  it("applies tech percentages and the debt penalty", () => {
    let s = fresh();
    s.empires[0]!.techs = ["automation"]; // +10% industry
    expect(colonyOutput(s, pack, capital(s)).industry).toBe(11); // floor(10 * 1.1)
    s.empires[0]!.credits = -1;
    expect(colonyOutput(s, pack, capital(s)).industry).toBe(5); // halved while in debt
  });

  it("caps population by planet size and habitability, plus tech", () => {
    const s = fresh();
    const home = s.galaxy.systems[s.empires[0]!.homeSystemId]!.bodies[0]!;
    expect(maxPopulation(pack, home, { maxPop: 0, maxPopPercent: 0 } as never)).toBe(8);
    expect(maxPopulation(pack, home, { maxPop: 2, maxPopPercent: 20 } as never)).toBe(9 + 2);
  });
});

describe("production", () => {
  it("completes builds, carries overflow, and spawns ships at the colony", () => {
    let s = fresh();
    const cap = capital(s);
    s = run(s, { type: "queueBuild", empireId: 0, colonyId: cap.id, item: { kind: "ship", id: "scout" } });
    s = run(s, { type: "queueBuild", empireId: 0, colonyId: cap.id, item: { kind: "building", id: "factory" } });
    expect(queueForecast(s, pack, capital(s))).toEqual([2, 5]); // 10 industry: scout 15, then factory 30 (45 total)
    s = run(s, end, end);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "shipCompleted", empireId: 0 }));
    expect(s.fleets.filter((f) => f.empireId === 0 && f.templateId === "scout").map((f) => f.name)).toEqual(["Scout 1", "Scout 2"]);
    expect(capital(s).progress).toBe(5); // 20 invested, 15 spent
    s = run(s, end, end, end);
    expect(capital(s).buildings).toContain("factory");
  });

  it("rejects duplicate buildings and locked items", () => {
    const s = fresh();
    const colonyId = capital(s).id;
    const queue = (id: string, kind: "building" | "ship" = "building") => applyCommand(s, { type: "queueBuild", empireId: 0, colonyId, item: { kind, id } }, pack);
    expect(queue("capitol").ok).toBe(false); // not buildable
    expect(queue("hydroponic_farm")).toMatchObject({ ok: false, error: "needs hydroponics" });
    const once = run(s, { type: "queueBuild", empireId: 0, colonyId, item: { kind: "building", id: "factory" } });
    expect(applyCommand(once, { type: "queueBuild", empireId: 0, colonyId, item: { kind: "building", id: "factory" } }, pack).ok).toBe(false);
  });

  it("turns idle industry into credits", () => {
    const s = fresh();
    const eco = empireEconomy(s, pack, 0);
    expect(eco.idleCredits).toBe(Math.floor((10 * pack.economy.idleIndustryCreditsPercent) / 100));
    const after = run(s, end);
    expect(after.empires[0]!.credits).toBe(s.empires[0]!.credits + eco.netCredits);
  });

  it("buys the current build for credits", () => {
    let s = fresh();
    const colonyId = capital(s).id;
    s = run(s, { type: "queueBuild", empireId: 0, colonyId, item: { kind: "building", id: "factory" } });
    expect(buyCost(pack, capital(s))).toBe(60);
    expect(applyCommand(s, { type: "buyBuild", empireId: 0, colonyId }, pack)).toMatchObject({ ok: false, error: "not enough credits" });
    s.empires[0]!.credits = 100;
    s = run(s, { type: "buyBuild", empireId: 0, colonyId });
    expect(s.empires[0]!.credits).toBe(40);
    expect(buyCost(pack, capital(s))).toBeNull();
    s = run(s, end);
    expect(capital(s).buildings).toContain("factory");
  });
});

describe("research", () => {
  it("banks points until a tech is chosen, then completes it and applies effects", () => {
    let s = fresh();
    s = run(s, end, end, end);
    const banked = s.empires[0]!.research.progress;
    expect(banked).toBe(15); // 5 per turn
    s = run(s, { type: "setResearch", empireId: 0, techId: "ion_drives" });
    while (!s.empires[0]!.techs.includes("ion_drives")) s = run(s, end);
    const scout = s.fleets.find((f) => f.empireId === 0 && f.templateId === "scout")!;
    expect(scout.speed).toBe(140 + 20);
    expect(s.empires[0]!.research.current).toBeNull();
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "techResearched", techId: "ion_drives" }));
  });

  it("requires prerequisites", () => {
    expect(applyCommand(fresh(), { type: "setResearch", empireId: 0, techId: "fusion_drives" }, pack).ok).toBe(false);
  });

  it("extends sensor range for colonies too", () => {
    const s = fresh();
    s.empires[0]!.techs = [];
    let t = run(s, { type: "setResearch", empireId: 0, techId: "improved_scanners" });
    t.empires[0]!.research.progress = 1000;
    t = run(t, end);
    expect(t.empires[0]!.capitalSensorRange).toBe(pack.economy.capitalSensorRange + 50);
  });
});

describe("colonization", () => {
  function atTarget(): { s: GameState; fleetId: number; bodyId: number } {
    const s = fresh();
    const ship = s.fleets.find((f) => f.empireId === 0 && f.templateId === "colony_ship")!;
    // Find any colonizable planet and teleport the colony ship there for the test.
    for (const system of s.galaxy.systems) {
      const body = system.bodies.find((b) => b.kind === "planet" && b.planetType === "arid" && !s.colonies.some((c) => c.bodyId === b.id));
      if (body) {
        ship.systemId = system.id;
        return { s, fleetId: ship.id, bodyId: body.id };
      }
    }
    throw new Error("no arid planet in test galaxy");
  }

  it("founds a colony and consumes the ship", () => {
    const { s, fleetId, bodyId } = atTarget();
    const t = run(s, { type: "colonize", empireId: 0, fleetId, bodyId });
    const colony = t.colonies.find((c) => c.bodyId === bodyId)!;
    expect(colony).toMatchObject({ empireId: 0, population: 1, capital: false, focus: "balanced" });
    expect(t.fleets.some((f) => f.id === fleetId)).toBe(false);
  });

  it("refuses taken, hostile, distant or non-planet targets and non-colony ships", () => {
    const { s, fleetId, bodyId } = atTarget();
    const t = run(s, { type: "colonize", empireId: 0, fleetId, bodyId });
    const second = t.fleets.find((f) => f.empireId === 0 && f.templateId === "scout")!;
    expect(applyCommand(t, { type: "colonize", empireId: 0, fleetId: second.id, bodyId }, pack)).toMatchObject({ ok: false, error: "not a colony ship" });
    const capitalBody = capital(s, 1).bodyId;
    expect(applyCommand(s, { type: "colonize", empireId: 0, fleetId, bodyId: capitalBody }, pack)).toMatchObject({ ok: false });
    const toxic = s.galaxy.systems.flatMap((sys) => sys.bodies).find((b) => b.planetType === "toxic");
    if (toxic) {
      const sys = s.galaxy.systems.find((x) => x.bodies.includes(toxic))!;
      s.fleets.find((f) => f.id === fleetId)!.systemId = sys.id;
      expect(applyCommand(s, { type: "colonize", empireId: 0, fleetId, bodyId: toxic.id }, pack)).toMatchObject({ ok: false, error: expect.stringMatching(/too hostile/) });
    }
  });

  it("grows a new colony toward its cap", () => {
    const { s, fleetId, bodyId } = atTarget();
    let t = run(s, { type: "colonize", empireId: 0, fleetId, bodyId });
    for (let i = 0; i < 40; i++) t = run(t, end);
    const colony = t.colonies.find((c) => c.bodyId === bodyId)!;
    expect(colony.population).toBeGreaterThan(1);
    expect(colony.population).toBeLessThanOrEqual(colonyOutput(t, pack, colony).maxPop);
  });
});

describe("food", () => {
  it("starves when stock runs out: growth reverses and population falls", () => {
    let s = fresh();
    const cap = capital(s);
    cap.population = 8;
    cap.buildings = []; // lose the capitol's food
    s.empires[0]!.food = 0;
    s = run(s, { type: "setFocus", empireId: 0, colonyId: cap.id, focus: "research" });
    // Research focus still feeds itself; force a deficit with an extra hungry barren colony.
    const barren = s.galaxy.systems.flatMap((sys) => sys.bodies.map((b) => ({ sys, b }))).find(({ b }) => b.planetType === "barren")!;
    s.colonies.push({ ...cap, id: 9999, capital: false, systemId: barren.sys.id, bodyId: barren.b.id, population: 6, buildings: [], growth: 0 });
    s = run(s, end);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "starvation", empireId: 0 }));
    for (let i = 0; i < 6; i++) s = run(s, end);
    expect(s.colonies.find((c) => c.id === 9999)!.population).toBeLessThan(6);
  });
});

describe("knowledge and attention", () => {
  it("shows rival colonies only once sensed, and only their public details", () => {
    const s = fresh();
    const view = empireView(s, 0);
    const rivalHome = s.empires[1]!.homeSystemId;
    expect(view.systems[rivalHome]!.colonies).toEqual([]);
    expect(view.systems[s.empires[0]!.homeSystemId]!.colonies).toMatchObject([{ own: true, capital: true }]);
  });

  it("asks for research, empty queues and colony ships that can settle", () => {
    const s = fresh();
    const types = attentionItems(s, pack, 0).map((i) => i.type);
    expect(types[0]).toBe("chooseResearch");
    expect(types).toContain("emptyQueue");
  });

  it("an all-AI game expands, researches and stays deterministic", () => {
    const settings = { seed: "ai-econ", galaxySize: "small", aiCount: 2, allAI: true };
    const game = Game.create(settings, pack);
    for (let i = 0; i < 60; i++) game.endTurn();
    for (const empire of game.state.empires) {
      expect(game.state.colonies.filter((c) => c.empireId === empire.id).length).toBeGreaterThan(1);
      expect(empire.techs.length).toBeGreaterThan(3);
    }
  });
});

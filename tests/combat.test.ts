import { chartAll } from "./helpers";
import { describe, expect, it } from "vitest";
import {
  Game,
  applyCommand,
  colonyOutput,
  createInitialState,
  designStats,
  empireEffects,
  empireView,
  estimateOdds,
  fleetMaxSupply,
  fleetStrength,
  newFleet,
  suppliedSystems,
  type Command,
  type GameState,
} from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();
const end: Command = { type: "endTurn" };

function run(state: GameState, ...commands: Command[]): GameState {
  for (const command of commands) {
    const result = applyCommand(state, command, pack);
    if (!result.ok) throw new Error(`${command.type}: ${result.error}`);
    state = result.state;
  }
  return state;
}

/**
 * A line galaxy 0 - 1 - 2 - 3 - 4 - 5 - 6, lanes 200 long. Empire 0's capital
 * sits at system 0 (supply reaches 400: systems 0-2), empire 1's at system 6.
 * No fleets unless a test adds them.
 */
function line(): GameState {
  const state = createInitialState({ seed: "combat", galaxySize: "small", aiCount: 2 }, pack);
  state.galaxy.systems = state.galaxy.systems.slice(0, 7).map((s, i) => ({ ...s, id: i, x: i * 200, y: 0 }));
  state.galaxy.lanes = [0, 1, 2, 3, 4, 5].map((a) => ({ a, b: a + 1, length: 200 }));
  state.empires = state.empires.slice(0, 2);
  state.empires[0]!.homeSystemId = 0;
  state.empires[1]!.homeSystemId = 6;
  state.colonies = state.colonies.filter((c) => c.empireId < 2 && c.capital);
  state.colonies[0]!.systemId = 0;
  state.colonies[1]!.systemId = 6;
  for (const c of state.colonies) c.bodyId = state.galaxy.systems[c.systemId]!.bodies[0]?.id ?? c.bodyId;
  state.fleets = [];
  chartAll(state);
  return state;
}

function addFleet(state: GameState, empireId: number, designs: string[], systemId: number) {
  const fleet = newFleet(state, pack, state.empires[empireId]!, designs, systemId);
  state.fleets.push(fleet);
  return fleet;
}

describe("ship designs", () => {
  it("derives stats from hull and components", () => {
    const s = line();
    const frigate = s.empires[0]!.designs.find((d) => d.id === "frigate")!;
    const stats = designStats(pack, frigate, empireEffects(pack, s.empires[0]!));
    expect(stats).toMatchObject({ cost: 14 + 4 + 4 + 3, upkeep: 1, maxHp: 18 + 8, shield: 0, speed: 100, armed: true, role: "combat" });
    expect(stats.weapons).toEqual([
      { damage: 3, accuracy: 75, range: 2, ammo: 0 },
      { damage: 3, accuracy: 75, range: 2, ammo: 0 },
    ]);
  });

  it("validates new designs: slots, research, names", () => {
    const s = line();
    const create = (design: Partial<{ name: string; hull: string; components: string[] }>) =>
      applyCommand(s, { type: "createDesign", empireId: 0, design: { name: "Lancer", hull: "frigate", components: ["laser"], formation: "front", ...design } }, pack);
    expect(create({ components: ["laser", "laser", "laser", "laser"] })).toMatchObject({ ok: false, error: "only 3 slots" });
    expect(create({ hull: "cruiser" })).toMatchObject({ ok: false, error: "hull not available" });
    expect(create({ components: ["torpedo"] })).toMatchObject({ ok: false, error: expect.stringMatching(/not available/) });
    expect(create({ name: "Destroyer" })).toMatchObject({ ok: false, error: "a design with that name exists" });
    const t = run(s, { type: "createDesign", empireId: 0, design: { name: "Lancer", hull: "frigate", components: ["mass_driver", "mass_driver", "armor_plating"], formation: "front" } });
    const lancer = t.empires[0]!.designs.find((d) => d.name === "Lancer")!;
    expect(lancer.id).toMatch(/^design-/);
    const capital = t.colonies.find((c) => c.empireId === 0)!;
    const queued = run(t, { type: "queueBuild", empireId: 0, colonyId: capital.id, item: { kind: "ship", id: lancer.id } });
    expect(queued.colonies.find((c) => c.id === capital.id)!.queue).toEqual([{ kind: "ship", id: lancer.id }]);
    const retired = run(t, { type: "retireDesign", empireId: 0, designId: lancer.id });
    expect(applyCommand(retired, { type: "queueBuild", empireId: 0, colonyId: capital.id, item: { kind: "ship", id: lancer.id } }, pack).ok).toBe(false);
  });
});

describe("fleets", () => {
  it("moves at the speed of its slowest ship and merges and splits", () => {
    let s = line();
    const scouts = addFleet(s, 0, ["scout"], 0);
    const colony = addFleet(s, 0, ["colony_ship"], 0);
    expect(scouts.speed).toBe(155);
    s = run(s, { type: "mergeFleets", empireId: 0, fleetId: colony.id, intoFleetId: scouts.id });
    const merged = s.fleets.find((f) => f.id === scouts.id)!;
    expect(merged.ships).toHaveLength(2);
    expect(merged.speed).toBe(90);
    s = run(s, { type: "splitFleet", empireId: 0, fleetId: scouts.id, shipIds: [merged.ships[1]!.id] });
    expect(s.fleets.filter((f) => f.empireId === 0)).toHaveLength(2);
    expect(s.fleets.find((f) => f.id === scouts.id)!.speed).toBe(155);
  });

  it("refuses merging fleets in different places and detaching every ship", () => {
    let s = line();
    const a = addFleet(s, 0, ["frigate"], 0);
    const b = addFleet(s, 0, ["frigate"], 1);
    expect(applyCommand(s, { type: "mergeFleets", empireId: 0, fleetId: a.id, intoFleetId: b.id }, pack).ok).toBe(false);
    expect(applyCommand(s, { type: "splitFleet", empireId: 0, fleetId: a.id, shipIds: [a.ships[0]!.id] }, pack)).toMatchObject({ ok: false });
    s = run(s, { type: "renameFleet", empireId: 0, fleetId: a.id, name: "  Vanguard " });
    expect(s.fleets.find((f) => f.id === a.id)!.name).toBe("Vanguard");
  });

  it("colonizes with one ship of a mixed fleet and keeps the rest", () => {
    let s = line();
    const fleet = addFleet(s, 0, ["frigate", "colony_ship"], 1);
    const body = { id: 90001, kind: "planet" as const, planetType: "terran", size: "medium", richness: "normal" };
    s.galaxy.systems[1]!.bodies = [body];
    s = run(s, { type: "colonize", empireId: 0, fleetId: fleet.id, bodyId: body.id });
    expect(s.fleets.find((f) => f.id === fleet.id)!.ships.map((x) => x.designId)).toEqual(["frigate"]);
  });
});

describe("supply", () => {
  it("is only found at the empire's own colonies (and depots)", () => {
    const s = line();
    expect([...suppliedSystems(s, pack, 0)]).toEqual([0]);
  });

  it("burns onboard supply away from a colony, then slows and wears ships down", () => {
    let s = line();
    const fleet = addFleet(s, 0, ["frigate"], 0);
    const max = fleetMaxSupply(pack, s, fleet);
    expect(max).toBe(10);
    fleet.systemId = 1; // one lane from home is already the field
    s = run(s, end);
    expect(s.fleets[0]!.supply).toBe(9);
    for (let i = 0; i < 9; i++) s = run(s, end);
    expect(s.fleets[0]!.supply).toBe(0);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "outOfSupply", fleetId: fleet.id }));
    expect(s.fleets[0]!.speed).toBe(67); // 100 - 33%
    const hp = s.fleets[0]!.ships[0]!.hp;
    s = run(s, end);
    expect(s.fleets[0]!.ships[0]!.hp).toBe(hp - 3); // 10% of 26, rounded up
    // Back in supply: refilled and repaired at the colony.
    s.fleets[0]!.systemId = 0;
    s = run(s, end);
    expect(s.fleets[0]!.supply).toBe(10);
    expect(s.fleets[0]!.ships[0]!.hp).toBeGreaterThan(hp - 3);
  });

  it("tankers extend a fleet's endurance", () => {
    const s = line();
    const fleet = addFleet(s, 0, ["frigate", "tanker"], 0);
    expect(fleetMaxSupply(pack, s, fleet)).toBe(10 + 8);
  });

  it("supply ships keep a fleet supplied in the field until their stores run out", () => {
    let s = line();
    const fleet = addFleet(s, 0, ["frigate", "frigate", "supply_ship"], 3);
    expect(fleet.stores).toBe(40); // two holds of 20 ship-turns
    s = run(s, end);
    expect(s.fleets[0]!.supply).toBe(10); // spent a turn, then topped up
    expect(s.fleets[0]!.stores).toBe(37); // three ships drew a turn each
    for (let i = 0; i < 12; i++) s = run(s, end);
    expect(s.fleets[0]!.stores).toBe(1);
    expect(s.fleets[0]!.supply).toBe(10);
    s = run(s, end); // too little left for the whole fleet: the clock starts
    expect(s.fleets[0]!.supply).toBe(9);
    s.fleets[0]!.systemId = 0;
    s = run(s, end); // home: supply and stores refilled
    expect(s.fleets[0]).toMatchObject({ supply: 10, stores: 40 });
  });

  it("an enemy warship in orbit blockades an undefended colony: no supply, no trade", () => {
    let s = line();
    const home = s.colonies.find((c) => c.empireId === 0)!;
    home.buildings = ["capitol"];
    home.defenseHp = 0;
    addFleet(s, 1, ["frigate"], 0);
    s = run(s, end);
    const capital = s.colonies.find((c) => c.empireId === 0)!;
    expect(capital.blockaded).toBe(true);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "blockaded", empireId: 0 }));
    expect(colonyOutput(s, pack, capital).credits).toBe(0);
    expect(suppliedSystems(s, pack, 0).size).toBe(0);
  });
});

describe("combat", () => {
  it("fights when armed fleets of two empires share a system, and replays identically", () => {
    const setup = () => {
      const s = line();
      addFleet(s, 0, ["frigate", "frigate", "frigate"], 3);
      addFleet(s, 1, ["frigate"], 3);
      return s;
    };
    const a = run(setup(), end);
    const b = run(setup(), end);
    expect(a.lastBattles).toHaveLength(1);
    expect(a.lastBattles).toEqual(b.lastBattles);
    const report = a.lastBattles[0]!;
    expect(report.systemId).toBe(3);
    expect(report.empires).toEqual([0, 1]);
    expect(report.rounds.length).toBeGreaterThan(0);
    const events = a.lastTurnEvents.filter((e) => e.type === "battle");
    expect(events.map((e) => e.empireId).sort()).toEqual([0, 1]);
  });

  it("the stronger side wins most battles", () => {
    let wins = 0;
    for (let seed = 0; seed < 20; seed++) {
      const s = line();
      s.rngState = seed * 7919;
      addFleet(s, 0, ["frigate", "frigate", "frigate"], 3);
      addFleet(s, 1, ["frigate"], 3);
      const t = run(s, end);
      if (t.lastTurnEvents.some((e) => e.type === "battle" && e.empireId === 0 && e.outcome === "won")) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(15);
  });

  it("unarmed fleets don't start fights, and evade after the first round", () => {
    let s = line();
    addFleet(s, 0, ["scout"], 3);
    addFleet(s, 1, ["scout"], 3);
    expect(run(s, end).lastBattles).toEqual([]);
    s = line();
    const scout = addFleet(s, 0, ["scout"], 3);
    addFleet(s, 1, ["frigate"], 3);
    const t = run(s, end);
    const report = t.lastBattles[0]!;
    expect(report.rounds.length).toBe(1);
    const survivor = t.fleets.find((f) => f.id === scout.id)!;
    expect(survivor.route).toEqual([2]); // withdrawing toward supply
  });

  it("retreats at the threshold toward friendly supply", () => {
    const s = line();
    const weak = addFleet(s, 0, ["frigate"], 3);
    weak.orders.retreatPercent = 10;
    addFleet(s, 1, ["frigate", "frigate", "frigate", "frigate"], 3);
    const t = run(s, end);
    const report = t.lastBattles[0]!;
    const survivor = t.fleets.find((f) => f.id === weak.id)!;
    expect(report.results.find((r) => r.empireId === 0)!.retreated).toEqual([weak.id]);
    expect(survivor.route.at(-1)).toBe(2); // nearest supplied system
  });

  it("guards stop fleets passing through their system", () => {
    let s = line();
    addFleet(s, 1, ["frigate"], 3);
    const runner = addFleet(s, 0, ["scout"], 2);
    s = run(s, { type: "moveFleet", empireId: 0, fleetId: runner.id, destinationId: 5 });
    s = run(s, end, end); // 155 per turn: reaches system 3 (200 away) on the second turn
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "fleetIntercepted", fleetId: runner.id, systemId: 3 }));
  });

  it("shows battles only to the empires that fought", () => {
    const s = line();
    s.empires.push({ ...s.empires[1]!, id: 2, homeSystemId: 6 });
    addFleet(s, 0, ["frigate"], 3);
    addFleet(s, 1, ["frigate"], 3);
    const t = run(s, end);
    expect(empireView(t, pack, 0).battles).toHaveLength(1);
    expect(empireView(t, pack, 2).battles).toHaveLength(0);
  });

  it("reports sighted fleets' size and strength", () => {
    let s = line();
    const enemy = addFleet(s, 1, ["frigate", "frigate"], 4);
    addFleet(s, 0, ["scout"], 3);
    s = run(s, end);
    const seen = empireView(s, pack, 0).fleets.find((f) => f.id === enemy.id)!;
    expect(seen).toMatchObject({ own: false, ships: 2, armed: true, strength: fleetStrength(pack, s, s.fleets.find((f) => f.id === enemy.id)!) });
  });
});

describe("pre-battle odds", () => {
  it("compares strength with what is known at the destination and on the way", () => {
    let s = line();
    const mine = addFleet(s, 0, ["frigate", "frigate", "frigate"], 2);
    const enemy = addFleet(s, 1, ["frigate"], 4);
    addFleet(s, 1, ["frigate"], 3);
    addFleet(s, 0, ["scout"], 3); // eyes on systems 3 and 4
    s = run(s, end);
    const view = empireView(s, pack, 0);
    const strength = fleetStrength(pack, s, s.fleets.find((f) => f.id === mine.id)!);
    const odds = estimateOdds(view, strength, [3, 4]);
    expect(odds.enemyStrength).toBe(fleetStrength(pack, s, s.fleets.find((f) => f.id === enemy.id)!));
    expect(odds.verdict).toBe("favorable");
    expect(odds.blockedAt).toEqual([3]);
    expect(estimateOdds(view, 1, [4]).verdict).toBe("unfavorable");
    expect(estimateOdds(view, strength, [6]).verdict).toBe("unknown"); // beyond sensors
  });
});

describe("all-AI games with combat", () => {
  it("stay deterministic and fight", () => {
    const settings = { seed: "war", galaxySize: "small", aiCount: 3, allAI: true };
    const a = Game.create(settings, pack);
    const b = Game.create(settings, pack);
    for (let i = 0; i < 80; i++) {
      a.endTurn();
      b.endTurn();
    }
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  }, 30_000); // two full AI games
});

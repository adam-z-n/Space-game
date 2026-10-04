import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  attentionItems,
  createInitialState,
  deserializeSave,
  empireView,
  planMove,
  type Command,
  type GameState,
} from "../src/core";
import { defaultPack } from "../src/content/defaultPack";
import { relocateCapitals, testFleet, testPack, chartAll } from "./helpers";

const pack = testPack;

/**
 * A line galaxy 0 - 1 - 2 - 3 - 4, lanes 100 long, systems 100 apart.
 * Empire 0 based at system 0, empire 1 at system 4, no colonies.
 * Each has one fleet at home with sensor range 120 and speed 100.
 */
function lineState(): GameState {
  const state = createInitialState({ seed: "vision", galaxySize: "small", aiCount: 2 }, pack);
  state.galaxy.systems = state.galaxy.systems.slice(0, 5).map((s, i) => ({ ...s, id: i, x: i * 100, y: 0 }));
  state.galaxy.lanes = [0, 1, 2, 3].map((a) => ({ a, b: a + 1, length: 100 }));
  state.empires = state.empires.slice(0, 2).map((e, i) => ({
    ...e,
    homeSystemId: i * 4,
    explored: [i * 4],
    sightings: [],
  }));
  // Capitals stay (or the empires would be eliminated) but see nothing: only the fleets' sensors matter here.
  relocateCapitals(state, [0, 4]);
  state.fleets = [
    testFleet(state, { id: 100, empireId: 0, systemId: 0, hull: "test100", name: "Blue" }),
    testFleet(state, { id: 200, empireId: 1, systemId: 4, hull: "test100", name: "Red" }),
  ];
  chartAll(state);
  return state;
}

function run(state: GameState, ...commands: Command[]): GameState {
  for (const command of commands) {
    const result = applyCommand(state, command, pack);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  return state;
}

const move = (empireId: number, fleetId: number, destinationId: number): Command => ({ type: "moveFleet", empireId, fleetId, destinationId });
const end: Command = { type: "endTurn" };

describe("fog of war", () => {
  it("hides fleets outside sensor range", () => {
    const view = empireView(lineState(), pack, 0);
    expect(view.fleets.map((f) => f.id)).toEqual([100]);
  });

  it("spots a fleet entering sensor range and reports it once", () => {
    let s = run(lineState(), move(1, 200, 2), end); // red at 3
    expect(s.empires[0]!.sightings).toEqual([]);
    s = run(s, end); // red at 2: 200 from blue's fleet at 0, out of range 120
    s = run(s, move(0, 100, 1), end); // blue to 1: red at 2 is 100 away
    expect(s.empires[0]!.sightings).toMatchObject([{ fleetId: 200, systemId: 2, turn: s.turn }]);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "fleetSighted", empireId: 0, fleetId: 200 }));
    s = run(s, end); // still in view: no repeat event
    expect(s.lastTurnEvents.filter((e) => e.type === "fleetSighted" && e.empireId === 0)).toEqual([]);
  });

  it("keeps last-known positions once a fleet leaves range", () => {
    let s = run(lineState(), move(1, 200, 2), end, end, move(0, 100, 1), end);
    const seen = s.turn;
    s = run(s, move(1, 200, 4), move(0, 100, 0), end, end); // both pull back out of range
    const view = empireView(s, pack, 0);
    const red = view.fleets.find((f) => f.id === 200)!;
    expect(red).toMatchObject({ own: false, seenTurn: seen, position: { systemId: 2 } });
    expect(red.route).toBeNull();
    expect(red.speed).toBeNull();
  });

  it("drops a stale sighting when its spot is seen empty", () => {
    let s = run(lineState(), move(1, 200, 2), end, end, move(0, 100, 1), end);
    s = run(s, move(1, 200, 4), move(0, 100, 0), end); // both leave
    expect(s.empires[0]!.sightings.length).toBe(1);
    s = run(s, move(0, 100, 2), end, end); // blue goes to 2 and finds nothing
    expect(s.empires[0]!.sightings).toEqual([]);
  });

  it("reveals bodies only for explored systems", () => {
    const view = empireView(lineState(), pack, 0);
    expect(view.systems[0]!.bodies).not.toBeNull();
    expect(view.systems[2]!.bodies).toBeNull();
    expect(view.systems[4]!.colonies).toEqual([]);
  });

  it("never exposes another empire's orders", () => {
    const s = run(lineState(), move(1, 200, 0), end, end, end); // red at 1, in range, still under orders
    const red = empireView(s, pack, 0).fleets.find((f) => f.id === 200);
    expect(red).toBeDefined();
    expect(JSON.stringify(red)).not.toContain("route\":[");
  });
});

describe("orders", () => {
  it("previews a route with turns to arrive", () => {
    expect(planMove(lineState(), 100, 3)).toMatchObject({ route: [1, 2, 3], distance: 300, turns: 3 });
    expect(planMove(lineState(), 100, 0)).toMatchObject({ route: [], distance: 0, turns: 0 });
  });

  it("holding removes an idle fleet from the attention queue until it moves again", () => {
    let s = lineState();
    const idle = (st: GameState) => attentionItems(st, pack, 0).filter((i) => i.type === "idleFleet");
    expect(idle(s)).toEqual([{ type: "idleFleet", fleetId: 100, systemId: 0 }]);
    s = run(s, { type: "setHold", empireId: 0, fleetId: 100, hold: true });
    expect(idle(s)).toEqual([]);
    s = run(s, move(0, 100, 1));
    expect(s.fleets[0]!.holding).toBe(false);
    expect(idle(s)).toEqual([]); // moving
    s = run(s, end);
    expect(idle(s)).toHaveLength(1); // arrived, idle again
  });

  it("refuses to hold a moving fleet", () => {
    const s = run(lineState(), move(0, 100, 2));
    expect(applyCommand(s, { type: "setHold", empireId: 0, fleetId: 100, hold: true }, pack)).toEqual({ ok: false, error: "fleet is moving" });
  });
});

describe("save migration", () => {
  it("refuses a save from a newer version of the game with a clear message", () => {
    const json = readFileSync(new URL("./fixtures/save-v2-m2.json", import.meta.url), "utf8");
    const save = JSON.parse(json);
    save.state.version = 999;
    expect(() => deserializeSave(JSON.stringify(save), defaultPack())).toThrow(/newer version of the game/);
  });

  it("loads a real Milestone 2 save and keeps playing", () => {
    const json = readFileSync(new URL("./fixtures/save-v2-m2.json", import.meta.url), "utf8");
    const loaded = deserializeSave(json, defaultPack());
    const state = loaded.state;
    expect(state.version).toBe(10);
    expect(state.empires[0]!.charted.length).toBeGreaterThan(state.empires[0]!.explored.length);
    expect(state.turn).toBe(7);
    // Every empire gets its capital on its homeworld; fleets map to ship templates.
    for (const empire of state.empires) {
      const capital = state.colonies.find((c) => c.empireId === empire.id && c.capital)!;
      expect(capital.systemId).toBe(empire.homeSystemId);
      expect(capital.buildings).toEqual(defaultPack().start.capitalBuildings);
    }
    expect(new Set(state.fleets.flatMap((f) => f.ships.map((s) => s.designId)))).toEqual(new Set(["scout", "frigate"]));
    expect(state.empires.every((e) => e.designs.length === defaultPack().startingDesigns.length)).toBe(true);
    expect(state.fleets.every((f) => f.speed > 0 && f.sensorRange > 0)).toBe(true);
    for (let i = 0; i < 5; i++) loaded.endTurn();
    expect(loaded.state.turn).toBe(12);
  });
});

import { describe, expect, it } from "vitest";
import {
  Game,
  applyCommand,
  attentionItems,
  createInitialState,
  deserializeSave,
  empireView,
  planMove,
  serializeSave,
  type Command,
  type GameState,
} from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();

/**
 * A line galaxy 0 - 1 - 2 - 3 - 4, lanes 100 long, systems 100 apart.
 * Empire 0 at system 0 (home sensor 50), empire 1 at system 4 (home sensor 50).
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
    homeSensorRange: 50,
    sightings: [],
  }));
  state.fleets = [
    { id: 100, empireId: 0, name: "Blue", speed: 100, sensorRange: 120, systemId: 0, route: [], progress: 0, holding: false },
    { id: 200, empireId: 1, name: "Red", speed: 100, sensorRange: 120, systemId: 4, route: [], progress: 0, holding: false },
  ];
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
    const view = empireView(lineState(), 0);
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
    const view = empireView(s, 0);
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
    const view = empireView(lineState(), 0);
    expect(view.systems[0]!.bodies).not.toBeNull();
    expect(view.systems[2]!.bodies).toBeNull();
    expect(view.systems[4]!.homeOf).toBeNull();
  });

  it("never exposes another empire's orders", () => {
    const s = run(lineState(), move(1, 200, 0), end, end, end); // red at 1, in range, still under orders
    const red = empireView(s, 0).fleets.find((f) => f.id === 200);
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
    expect(attentionItems(s, 0)).toEqual([{ type: "idleFleet", fleetId: 100, systemId: 0 }]);
    s = run(s, { type: "setHold", empireId: 0, fleetId: 100, hold: true });
    expect(attentionItems(s, 0)).toEqual([]);
    s = run(s, move(0, 100, 1));
    expect(s.fleets[0]!.holding).toBe(false);
    expect(attentionItems(s, 0)).toEqual([]); // moving
    s = run(s, end);
    expect(attentionItems(s, 0)).toHaveLength(1); // arrived, idle again
  });

  it("refuses to hold a moving fleet", () => {
    const s = run(lineState(), move(0, 100, 2));
    expect(applyCommand(s, { type: "setHold", empireId: 0, fleetId: 100, hold: true }, pack)).toEqual({ ok: false, error: "fleet is moving" });
  });
});

describe("save migration", () => {
  it("loads a version 1 save", () => {
    const game = Game.create({ seed: "old", galaxySize: "small", aiCount: 2 }, pack);
    game.endTurn();
    const save = JSON.parse(serializeSave(game));
    save.state.version = 1;
    for (const e of save.state.empires) {
      delete e.homeSensorRange;
      delete e.sightings;
    }
    for (const f of save.state.fleets) {
      delete f.sensorRange;
      delete f.holding;
    }
    const loaded = deserializeSave(JSON.stringify(save), pack);
    expect(loaded.state.version).toBe(2);
    expect(loaded.state.fleets.every((f) => f.sensorRange > 0 && f.holding === false)).toBe(true);
    loaded.endTurn();
  });
});

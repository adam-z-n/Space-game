import { describe, expect, it } from "vitest";
import {
  Game,
  applyCommand,
  createInitialState,
  deserializeSave,
  replay,
  serializeSave,
  stateHash,
  type GameState,
} from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();

/** A tiny hand-built galaxy: 0 -100- 1 -100- 2 -100- 3, plus a 400 shortcut 0-3. One fleet at 0, speed 60. */
function lineState(): GameState {
  const state = createInitialState({ seed: "line", galaxySize: "small", aiCount: 2 }, pack);
  state.galaxy.systems = state.galaxy.systems.slice(0, 4).map((s, i) => ({ ...s, id: i, x: i * 100, y: 0 }));
  state.galaxy.lanes = [
    { a: 0, b: 1, length: 100 },
    { a: 0, b: 3, length: 400 },
    { a: 1, b: 2, length: 100 },
    { a: 2, b: 3, length: 100 },
  ];
  state.empires = state.empires.map((e) => ({ ...e, homeSystemId: 0, explored: [0] }));
  state.fleets = [{ id: 500, empireId: 0, name: "Test", templateId: "scout", speed: 60, sensorRange: 0, systemId: 0, route: [], progress: 0, holding: false }];
  state.colonies = [];
  return state;
}

function run(state: GameState, ...commands: Parameters<typeof applyCommand>[1][]): GameState {
  for (const command of commands) {
    const result = applyCommand(state, command, pack);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  return state;
}

const move = (destinationId: number) => ({ type: "moveFleet" as const, empireId: 0, fleetId: 500, destinationId });
const end = { type: "endTurn" as const };

describe("fleet movement", () => {
  it("takes the shortest lane route", () => {
    expect(run(lineState(), move(3)).fleets[0]!.route).toEqual([1, 2, 3]);
  });

  it("moves speed per turn and carries leftover movement through systems", () => {
    let s = run(lineState(), move(3), end);
    expect(s.fleets[0]).toMatchObject({ systemId: 0, progress: 60, route: [1, 2, 3] });
    s = run(s, end); // 120 travelled: through system 1, 20 along to 2
    expect(s.fleets[0]).toMatchObject({ systemId: 1, progress: 20, route: [2, 3] });
    expect(s.empires[0]!.explored).toEqual([0, 1]);
    expect(s.lastTurnEvents).toEqual([{ type: "systemExplored", turn: 2, empireId: 0, systemId: 1 }]);
    s = run(s, end, end, end); // 300 total: arrives
    expect(s.fleets[0]).toMatchObject({ systemId: 3, progress: 0, route: [] });
    expect(s.lastTurnEvents.some((e) => e.type === "fleetArrived")).toBe(true);
  });

  it("turns around mid-lane when going back is shorter", () => {
    let s = run(lineState(), move(2), end); // 60 along 0->1
    s = run(s, move(0));
    expect(s.fleets[0]).toMatchObject({ systemId: 1, route: [0], progress: 40 });
    s = run(s, end);
    expect(s.fleets[0]).toMatchObject({ systemId: 0, route: [], progress: 0 });
  });

  it("presses on mid-lane when that is shorter", () => {
    let s = run(lineState(), move(1), end); // 60 along 0->1
    s = run(s, move(2));
    expect(s.fleets[0]).toMatchObject({ systemId: 0, route: [1, 2], progress: 60 });
  });

  it("cancels orders when sent to its own system", () => {
    const s = run(lineState(), move(2), move(0));
    expect(s.fleets[0]!.route).toEqual([]);
  });

  it("rejects orders for another empire's fleet or a missing system", () => {
    const s = lineState();
    expect(applyCommand(s, { ...move(1), empireId: 1 }, pack)).toEqual({ ok: false, error: "fleet belongs to another empire" });
    expect(applyCommand(s, move(99), pack).ok).toBe(false);
  });

  it("never mutates the input state", () => {
    const s = lineState();
    const before = JSON.stringify(s);
    run(s, move(3), end, end);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("Game session", () => {
  const settings = { seed: "session", galaxySize: "medium", aiCount: 4 };

  it("advances turns and lets AI empires explore", () => {
    const game = Game.create(settings, pack);
    for (let i = 0; i < 10; i++) game.endTurn();
    expect(game.state.turn).toBe(11);
    for (const empire of game.state.empires.filter((e) => e.isAI)) expect(empire.explored.length).toBeGreaterThan(1);
  });

  it("undoes orders within the current turn only", () => {
    const game = Game.create(settings, pack);
    const fleet = game.state.fleets.find((f) => f.empireId === 0)!;
    const neighbor = game.state.galaxy.lanes.find((l) => l.a === fleet.systemId || l.b === fleet.systemId)!;
    const target = neighbor.a === fleet.systemId ? neighbor.b : neighbor.a;

    expect(game.issue({ type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: target })).toBeNull();
    expect(game.state.fleets.find((f) => f.id === fleet.id)!.route).toEqual([target]);
    expect(game.undo()).toBe(true);
    expect(game.state.fleets.find((f) => f.id === fleet.id)!.route).toEqual([]);
    expect(game.undo()).toBe(false);

    game.issue({ type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: target });
    game.endTurn();
    expect(game.canUndo).toBe(false);
  });

  it("rejects invalid player orders without logging them", () => {
    const game = Game.create(settings, pack);
    expect(game.issue({ type: "moveFleet", empireId: 0, fleetId: 123456, destinationId: 0 })).toMatch(/no fleet/);
    expect(game.log).toHaveLength(0);
  });

  it("replays to the identical state from settings + command log", () => {
    const game = Game.create(settings, pack);
    for (let i = 0; i < 25; i++) game.endTurn();
    expect(stateHash(replay(settings, game.log, pack))).toBe(stateHash(game.state));
  });

  it("round-trips through a save and continues identically", () => {
    const a = Game.create(settings, pack);
    for (let i = 0; i < 5; i++) a.endTurn();
    const b = deserializeSave(serializeSave(a), pack);
    expect(b.state).toEqual(a.state);
    for (let i = 0; i < 5; i++) {
      a.endTurn();
      b.endTurn();
    }
    expect(stateHash(b.state)).toBe(stateHash(a.state));
  });

  it("refuses saves from another format or pack", () => {
    const game = Game.create(settings, pack);
    const save = JSON.parse(serializeSave(game));
    expect(() => deserializeSave(JSON.stringify({ ...save, format: 99 }), pack)).toThrow(/format/);
    expect(() => deserializeSave(JSON.stringify({ ...save, contentPack: { id: "other" } }), pack)).toThrow(/content pack/);
  });
});

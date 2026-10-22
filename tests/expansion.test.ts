import { describe, expect, it } from "vitest";
import { applyCommand, buildBlocker, createInitialState, hullSlots, newColony, newFleet, planAiTurn, planMove, type Command, type GameState } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";
import { chartAll } from "./helpers";

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

function fresh(): GameState {
  const s = createInitialState({ seed: "expansion", galaxySize: "small", aiCount: 2 }, pack);
  chartAll(s);
  return s;
}

describe("more slots", () => {
  it("Microfabrication adds a slot to cruisers and larger, Molecular Assembly to every hull", () => {
    const s = fresh();
    const e = s.empires[0]!;
    const base = { frigate: hullSlots(pack, e, "frigate"), cruiser: hullSlots(pack, e, "cruiser") };
    e.techs.push("microfabrication");
    expect(hullSlots(pack, e, "frigate")).toBe(base.frigate);
    expect(hullSlots(pack, e, "cruiser")).toBe(base.cruiser + 1);
    e.techs.push("molecular_assembly");
    expect(hullSlots(pack, e, "frigate")).toBe(base.frigate + 1);
    expect(hullSlots(pack, e, "cruiser")).toBe(base.cruiser + 2);
  });
});

describe("gas giant habitats", () => {
  /** Empire 0's capital system with a gas giant added, and a habitat ship and a colony ship there. */
  function withGiant() {
    const s = fresh();
    const e = s.empires[0]!;
    e.techs.push("gas_giant_habitats");
    const home = e.homeSystemId;
    const giant = { id: 9900, kind: "gasGiant" as const };
    s.galaxy.systems[home]!.bodies.push(giant);
    const habitat = newFleet(s, pack, e, ["habitat_ship"], home);
    const settlers = newFleet(s, pack, e, ["colony_ship"], home);
    s.fleets.push(habitat, settlers);
    return { s, e, home, giant, habitat, settlers };
  }

  it("a habitat ship settles a gas giant; a colony ship can't, and colony bases don't reach them", () => {
    const { s, giant, habitat, settlers } = withGiant();
    expect(applyCommand(s, { type: "colonize", empireId: 0, fleetId: settlers.id, bodyId: giant.id }, pack)).toMatchObject({ ok: false, error: "gas giants need a habitat ship" });
    const capital = s.colonies.find((c) => c.empireId === 0 && c.capital)!;
    expect(buildBlocker(s, pack, s.empires[0]!, capital, { kind: "colonyBase", id: "colony_base", bodyId: giant.id })).toBe("colony bases settle planets only");
    const t = run(s, { type: "colonize", empireId: 0, fleetId: habitat.id, bodyId: giant.id });
    const colony = t.colonies.find((c) => c.bodyId === giant.id)!;
    expect(colony.empireId).toBe(0);
    expect(t.fleets.some((f) => f.id === habitat.id)).toBe(false); // the habitat ship is used up
  });

  it("needs the tech, and can't settle a gas giant that holds an outpost", () => {
    const { s, e, home, giant, habitat } = withGiant();
    s.outposts.push({ id: 9901, empireId: 0, systemId: home, bodyId: giant.id, kind: "mining", depot: false, defenseHp: 0 });
    expect(applyCommand(s, { type: "colonize", empireId: 0, fleetId: habitat.id, bodyId: giant.id }, pack)).toMatchObject({ ok: false, error: "an outpost holds it" });
    s.outposts = [];
    e.techs = e.techs.filter((t) => t !== "gas_giant_habitats");
    expect(applyCommand(s, { type: "colonize", empireId: 0, fleetId: habitat.id, bodyId: giant.id }, pack)).toMatchObject({ ok: false, error: "gas giants need Gas Giant Habitats" });
  });
});

describe("warp gates", () => {
  /** Empire 0 with gated colonies at its capital and at a far system, and a fleet at the capital. */
  function gated() {
    const s = fresh();
    const e = s.empires[0]!;
    e.techs.push("warp_gates");
    const capital = s.colonies.find((c) => c.empireId === 0 && c.capital)!;
    capital.buildings.push("warp_gate");
    const far = s.galaxy.systems.filter((x) => x.id !== capital.systemId && x.bodies.some((b) => b.kind === "planet") && !s.colonies.some((c) => c.systemId === x.id)).at(-1)!;
    const body = far.bodies.find((b) => b.kind === "planet")!;
    const outpost = newColony(s, e, far.id, body.id, 3, false);
    outpost.buildings.push("warp_gate");
    s.colonies.push(outpost);
    const fleet = newFleet(s, pack, e, ["frigate"], capital.systemId);
    s.fleets.push(fleet);
    return { s, capital, far, outpost, fleet };
  }

  it("jumps a fleet between gated colonies in one turn", () => {
    const { s, far, fleet } = gated();
    expect(planMove(s, fleet.id, far.id, pack)).toMatchObject({ route: [far.id], warp: true, turns: 1 });
    const t = run(s, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: far.id }, end);
    const moved = t.fleets.find((f) => f.id === fleet.id)!;
    expect(moved.systemId).toBe(far.id);
    expect(moved.route).toEqual([]);
  });

  it("goes nowhere if the far gate is blockaded or lost by then", () => {
    const { s, far, outpost, fleet } = gated();
    let t = run(s, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: far.id });
    t.colonies.find((c) => c.id === outpost.id)!.buildings = []; // the gate is gone
    t = run(t, end);
    const stayed = t.fleets.find((f) => f.id === fleet.id)!;
    expect(stayed.systemId).toBe(s.empires[0]!.homeSystemId);
    expect(stayed.route).toEqual([]);
  });

  it("the AI builds gates at its capital once researched", () => {
    const s = createInitialState({ seed: "expansion-ai", galaxySize: "small", aiCount: 2, allAI: true }, pack);
    const ai = s.empires[1]!;
    ai.techs.push("warp_gates");
    ai.credits = 1000;
    const capital = s.colonies.find((c) => c.empireId === 1 && c.capital)!;
    capital.queue = [];
    capital.population = 8;
    // A few more colonies, so a gate network is worth it.
    for (const i of [1, 2, 3]) s.colonies.push({ ...newColony(s, ai, capital.systemId, 8800 + i, 3, false) });
    for (const i of [1, 2, 3]) s.galaxy.systems[capital.systemId]!.bodies.push({ id: 8800 + i, kind: "planet", planetType: "terran", size: "medium", richness: "normal" });
    const queued = planAiTurn(s, pack, 1).filter((c) => c.type === "queueBuild" && c.colonyId === capital.id);
    expect(queued).toContainEqual(expect.objectContaining({ item: { kind: "building", id: "warp_gate" } }));
  });
});

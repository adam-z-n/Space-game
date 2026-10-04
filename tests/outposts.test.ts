import { chartAll } from "./helpers";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createInitialState,
  empireEconomy,
  empireView,
  generateGalaxy,
  newFleet,
  suppliedSystems,
  Rng,
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

/** Line galaxy 0 - 1 - ... - 6 (lanes 200), capitals at 0 and 6; system 1 has an asteroid field and a gas giant. */
function line(): GameState {
  const s = createInitialState({ seed: "outposts", galaxySize: "small", aiCount: 2 }, pack);
  s.galaxy.systems = s.galaxy.systems.slice(0, 7).map((x, i) => ({ ...x, id: i, x: i * 200, y: 0, bodies: [] }));
  s.galaxy.lanes = [0, 1, 2, 3, 4, 5].map((a) => ({ a, b: a + 1, length: 200 }));
  s.empires = s.empires.slice(0, 2);
  s.empires[0]!.homeSystemId = 0;
  s.empires[1]!.homeSystemId = 6;
  s.colonies = s.colonies.filter((c) => c.empireId < 2 && c.capital);
  s.colonies.forEach((c) => {
    c.systemId = c.empireId === 0 ? 0 : 6;
    c.bodyId = 8000 + c.empireId;
    s.galaxy.systems[c.systemId]!.bodies = [{ id: c.bodyId, kind: "planet", planetType: "terran", size: "medium", richness: "normal" }];
  });
  s.galaxy.systems[1]!.bodies = [
    { id: 9001, kind: "asteroids" },
    { id: 9002, kind: "gasGiant" },
  ];
  s.fleets = [];
  for (const e of s.empires) e.explored = s.galaxy.systems.map((x) => x.id);
  chartAll(s);
  return s;
}

function withOutposter(s: GameState, systemId = 1) {
  const fleet = newFleet(s, pack, s.empires[0]!, ["outpost_ship"], systemId);
  s.fleets.push(fleet);
  return fleet;
}

describe("bigger galaxies", () => {
  it("make about a third of the systems planet-free", () => {
    const { galaxy } = generateGalaxy(Rng.fromSeed("empty"), pack, "medium", 1);
    expect(galaxy.systems).toHaveLength(64);
    const empty = galaxy.systems.filter((x) => !x.bodies.some((b) => b.kind === "planet")).length;
    expect(empty).toBeGreaterThanOrEqual(12);
  });
});

describe("outposts", () => {
  it("are built by outpost ships on asteroids and gas giants, once researched", () => {
    let s = line();
    const fleet = withOutposter(s);
    const build = (bodyId: number, kind: "combat" | "mining"): Command => ({ type: "buildOutpost", empireId: 0, fleetId: fleet.id, bodyId, kind });
    expect(applyCommand(s, build(9001, "combat"), pack)).toMatchObject({ ok: false, error: "Combat Outpost needs research" });
    s.empires[0]!.techs.push("outpost_construction");
    expect(applyCommand(s, build(9001, "mining"), pack)).toMatchObject({ ok: false, error: "Mining Outpost needs research" });
    expect(applyCommand(s, build(9002, "mining"), pack).ok).toBe(false); // gas giants can't be mined
    s = run(s, build(9002, "combat"));
    expect(s.outposts).toEqual([expect.objectContaining({ empireId: 0, systemId: 1, bodyId: 9002, kind: "combat", depot: false, defenseHp: 60 })]);
    expect(s.fleets.some((f) => f.id === fleet.id)).toBe(false); // ship used up
    expect(empireView(s, pack, 0).systems[1]!.outposts).toHaveLength(1);
  });

  it("mining outposts earn credits; outposts cost upkeep", () => {
    let s = line();
    s.empires[0]!.techs.push("outpost_construction", "asteroid_mining");
    const fleet = withOutposter(s);
    const before = empireEconomy(s, pack, 0);
    s = run(s, { type: "buildOutpost", empireId: 0, fleetId: fleet.id, bodyId: 9001, kind: "mining" });
    const after = empireEconomy(s, pack, 0);
    expect(after.miningIncome).toBe(pack.outposts.mining.credits);
    // The outpost ship's upkeep stops too.
    expect(after.netCredits).toBeGreaterThan(before.netCredits);
  });

  it("combat outposts fight and stop passing ships; destroyed ones are lost", () => {
    let s = line();
    s.outposts.push({ id: 7000, empireId: 1, systemId: 3, bodyId: 9003, kind: "combat", depot: false, defenseHp: 60 });
    s.galaxy.systems[3]!.bodies = [{ id: 9003, kind: "asteroids" }];
    const raiders = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate", "frigate", "frigate", "frigate", "frigate"], 2);
    raiders.orders = { ...raiders.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(raiders);
    s = run(s, { type: "moveFleet", empireId: 0, fleetId: raiders.id, destinationId: 5 }, end, end); // two turns to reach system 3
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "fleetIntercepted", fleetId: raiders.id, systemId: 3 }));
    expect(s.lastBattles[0]!.ships.some((x) => x.designName === "Combat Outpost")).toBe(true);
    for (let i = 0; i < 6 && s.outposts.length > 0; i++) s = run(s, end);
    expect(s.outposts).toHaveLength(0);
  });

  it("an unguarded mining outpost falls to any armed enemy fleet", () => {
    let s = line();
    s.outposts.push({ id: 7001, empireId: 1, systemId: 1, bodyId: 9001, kind: "mining", depot: false, defenseHp: 0 });
    s.fleets.push(newFleet(s, pack, s.empires[0]!, ["frigate"], 1));
    s = run(s, end);
    expect(s.outposts).toHaveLength(0);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "outpostLost", empireId: 1, kind: "mining" }));
  });

  it("supply depots extend supply for credits", () => {
    let s = line();
    s.empires[0]!.techs.push("outpost_construction", "supply_lines", "forward_depots");
    s.galaxy.systems[3]!.bodies = [{ id: 9003, kind: "gasGiant" }];
    s.outposts.push({ id: 7002, empireId: 0, systemId: 3, bodyId: 9003, kind: "combat", depot: false, defenseHp: 60 });
    expect(suppliedSystems(s, pack, 0).has(4)).toBe(false);
    s.empires[0]!.credits = 100;
    s = run(s, { type: "upgradeOutpost", empireId: 0, outpostId: 7002 });
    expect(s.empires[0]!.credits).toBe(100 - pack.outposts.depot.cost);
    expect(suppliedSystems(s, pack, 0).has(4)).toBe(true);
  });
});

describe("special operations", () => {
  function infiltration(): { s: GameState; fleetId: number } {
    const s = line();
    for (const e of s.empires) e.designs.push({ id: "spec", name: "Spec Ops", hull: "frigate", components: ["cloaking_device", "commando_team", "commando_team"], formation: "support", obsolete: false });
    const fleet = newFleet(s, pack, s.empires[0]!, ["spec", "spec"], 5);
    s.fleets.push(fleet);
    const cap = s.colonies.find((c) => c.empireId === 1)!;
    s.empires[0]!.colonySightings = [{ colonyId: cap.id, empireId: 1, systemId: 6, bodyId: cap.bodyId, name: cap.name, population: 5, defenseHp: cap.defenseHp, troops: 13, turn: 1 }];
    return { s, fleetId: fleet.id };
  }

  it("cloaked fleets are seen only up close and stay out of battle unless they attack", () => {
    let { s, fleetId } = infiltration();
    s.empires[1]!.capitalSensorRange = 250; // system 5 is 200 away: normally visible, but not cloaked
    s = run(s, end);
    expect(s.empires[1]!.sightings.some((x) => x.fleetId === fleetId)).toBe(false);
    s = run(s, { type: "moveFleet", empireId: 0, fleetId, destinationId: 6 }, end, end);
    const fleet = s.fleets.find((f) => f.id === fleetId)!;
    expect(fleet.systemId).toBe(6);
    expect(s.lastBattles.some((b) => b.empires.includes(0))).toBe(false); // the capital's guns don't see it
  });

  it("commandos sabotage a colony's defenses, and lose a ship when caught", () => {
    let { s, fleetId } = infiltration();
    s.fleets.find((f) => f.id === fleetId)!.systemId = 6;
    const cap = s.colonies.find((c) => c.empireId === 1)!;
    const full = cap.defenseHp;
    s = run(s, { type: "sabotage", empireId: 0, fleetId, colonyId: cap.id, mission: "defenses" });
    let sawSuccess = false;
    let sawFailure = false;
    for (let i = 0; i < 12 && s.fleets.some((f) => f.id === fleetId); i++) {
      const ships = s.fleets.find((f) => f.id === fleetId)!.ships.length;
      s = run(s, end);
      const event = s.lastTurnEvents.find((e) => e.type === "sabotage" && e.empireId === 0);
      if (event?.type === "sabotage" && event.success) {
        sawSuccess = true;
        expect(s.colonies.find((c) => c.id === cap.id)!.defenseHp).toBeLessThan(full);
      }
      if (event?.type === "sabotage" && !event.success) {
        sawFailure = true;
        expect(s.fleets.find((f) => f.id === fleetId)?.ships.length ?? 0).toBe(ships - 1);
      }
    }
    expect(sawSuccess || sawFailure).toBe(true);
  });
});

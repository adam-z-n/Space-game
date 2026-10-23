import { describe, expect, it } from "vitest";
import { chartAll, enlist } from "./helpers";
import { defaultPack } from "../src/content/defaultPack";
import { applyCommand, createInitialState, migrateState, newFleet, type Command, type GameState } from "../src/core";
import { commandCapacity, commandUsed, fleetPoints, freeOfficers, knownHostileSystems, supportedCommands } from "../src/core/command";
import { outpostDefense, outpostFinances } from "../src/core/outposts";
import { leadership } from "../src/core/combat";

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

function error(state: GameState, command: Command): string {
  const result = applyCommand(state, command, pack);
  return result.ok ? "ok" : result.error;
}

/**
 * Line galaxy 0 - 1 - 2 - 3 - 4, lanes 200 long. Empire 0's capital at 0 (no defenses), empire 1's
 * capital at 4. Each empire's first command is based at its capital. Empire 0 knows empire 1's capital.
 */
function line(): GameState {
  const s = createInitialState({ seed: "command", galaxySize: "small", aiCount: 2 }, pack);
  s.galaxy.systems = s.galaxy.systems.slice(0, 5).map((x, i) => ({ ...x, id: i, x: i * 400, y: 0 }));
  s.galaxy.lanes = [0, 1, 2, 3].map((a) => ({ a, b: a + 1, length: 200 }));
  s.empires = s.empires.slice(0, 2);
  s.colonies = s.colonies.filter((c) => c.empireId < 2);
  s.colonies.forEach((c, i) => {
    c.systemId = i === 0 ? 0 : 4;
    c.bodyId = 7000 + i;
    c.buildings = ["capitol"];
    c.defenseHp = 0;
    s.galaxy.systems[c.systemId]!.bodies = [{ id: c.bodyId, kind: "planet", planetType: "terran", size: "medium", richness: "normal" }];
  });
  s.empires.forEach((e, i) => {
    e.homeSystemId = i === 0 ? 0 : 4;
    e.navalCommands[0]!.homeSystemId = e.homeSystemId;
    e.capitalSensorRange = 0;
    e.colonySensorRange = 0;
    e.sightings = [];
  });
  s.fleets = [];
  chartAll(s);
  const target = s.colonies[1]!;
  s.empires[0]!.colonySightings = [
    { colonyId: target.id, empireId: 1, systemId: 4, bodyId: target.bodyId, name: target.name, population: target.population, defenseHp: 0, troops: 0, turn: 1 },
  ];
  return s;
}

/** An extra colony for empire 0 in `systemId`. */
function colonyAt(s: GameState, systemId: number, population = 3): void {
  const id = s.nextId++;
  s.galaxy.systems[systemId]!.bodies.push({ id, kind: "planet", planetType: "terran", size: "medium", richness: "normal" });
  const capital = s.colonies.find((c) => c.empireId === 0)!;
  s.colonies.push({ ...capital, id, systemId, bodyId: id, name: `Colony ${id}`, capital: false, population, buildings: [], queue: [] });
}

const form = (s: GameState, fleetId: number): Command => ({ type: "formFleet", empireId: 0, fleetId, flagshipId: s.fleets.find((f) => f.id === fleetId)!.ships[0]!.id });

describe("naval commands", () => {
  it("every empire starts with one command at its capital, and its starting warships form a fleet", () => {
    const s = createInitialState({ seed: "start", galaxySize: "small", aiCount: 2 }, pack);
    for (const empire of s.empires) {
      expect(empire.navalCommands).toEqual([expect.objectContaining({ name: "1st Command", homeSystemId: empire.homeSystemId, reserve: [], vacancies: [] })]);
      const fleets = s.fleets.filter((f) => f.empireId === empire.id);
      // Scout, two destroyers, colony ship: only the destroyers are a fleet.
      expect(fleets.filter((f) => f.command).map((f) => f.ships.length)).toEqual([2]);
      expect(fleets.find((f) => f.command)!.command).toMatchObject({ commandId: empire.navalCommands[0]!.id, cohesion: 100 });
    }
  });

  it("points: hull points for warships, 1 for support ships; 12 per command plus population and techs", () => {
    const s = line();
    const empire = s.empires[0]!;
    expect(fleetPoints(pack, s, newFleet(s, pack, empire, ["frigate", "frigate", "troop_transport"], 0))).toBe(2 + 2 + 1);
    const command = empire.navalCommands[0]!;
    const population = s.colonies.filter((c) => c.empireId === 0).reduce((n, c) => n + c.population, 0);
    expect(commandCapacity(s, pack, empire, command)).toBe(12 + Math.floor(population / 10));
    s.colonies.find((c) => c.empireId === 0)!.population = 25;
    expect(commandCapacity(s, pack, empire, command)).toBe(12 + 2);
    empire.techs.push("naval_staff_college", "fleet_admiralty");
    expect(commandCapacity(s, pack, empire, command)).toBe(12 + 2 + 4 + 8);
  });

  it("one command per five colonies, each placed at a colony of yours, one per system, ready in 3 turns", () => {
    let s = line();
    expect(supportedCommands(s, pack, 0)).toBe(1);
    const place: Command = { type: "placeCommand", empireId: 0, commandId: null, systemId: 2 };
    expect(error(s, place)).toContain("more colonies");
    for (const at of [1, 2, 2, 3]) colonyAt(s, at);
    expect(supportedCommands(s, pack, 0)).toBe(2);
    expect(error(s, { ...place, systemId: 0 })).toBe("another command is based there");
    expect(error(s, { ...place, systemId: 4 })).toBe("a command must be based at one of your colonies");
    s = run(s, place);
    const second = s.empires[0]!.navalCommands[1]!;
    expect(second).toMatchObject({ name: "2nd Command", homeSystemId: 2, readyTurn: s.turn + 3 });
    expect(error(s, place)).toContain("more colonies");
    // A fleet can't form there until the command is set up.
    const group = newFleet(s, pack, s.empires[0]!, ["frigate"], 2);
    s.fleets.push(group);
    expect(error(s, form(s, group.id))).toBe("2nd Command is still setting up");
    s = run(s, end, end, end);
    s = run(s, form(s, group.id));
    expect(s.fleets.find((f) => f.id === group.id)!.command!.commandId).toBe(second.id);
  });

  it("fleets form only at a command's home, led by an armed flagship, within officers and points", () => {
    let s = line();
    const away = newFleet(s, pack, s.empires[0]!, ["frigate"], 1);
    const transports = newFleet(s, pack, s.empires[0]!, ["troop_transport"], 0);
    const big = newFleet(s, pack, s.empires[0]!, Array.from({ length: 7 }, () => "frigate"), 0);
    const small = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate"], 0);
    s.fleets.push(away, transports, big, small);
    expect(error(s, form(s, away.id))).toBe("fleets form only where a naval command is based");
    expect(error(s, form(s, transports.id))).toBe("the flagship must be an armed ship");
    expect(error(s, form(s, big.id))).toBe("not enough points in 1st Command"); // 14 points of 12
    s = run(s, form(s, small.id));
    const fleet = s.fleets.find((f) => f.id === small.id)!;
    expect(fleet.command).toMatchObject({ flagshipId: small.ships[0]!.id, cohesion: 50 });
    expect(fleet.command!.officer.name.length).toBeGreaterThan(0);
    // One officer per command: no second fleet until Officer Academy.
    const another = newFleet(s, pack, s.empires[0]!, ["frigate"], 0);
    s.fleets.push(another);
    expect(error(s, form(s, another.id))).toBe("1st Command has no free officer");
    s.empires[0]!.techs.push("officer_academy");
    s = run(s, form(s, another.id));
    expect(commandUsed(s, pack, s.empires[0]!, s.empires[0]!.navalCommands[0]!)).toBe(4 + 2);
    // Cohesion builds 10% a turn.
    s = run(s, end, end);
    expect(s.fleets.find((f) => f.id === small.id)!.command!.cohesion).toBe(70);
  });

  it("merging: groups join a fleet while its command has points, at a cohesion cost; fleets don't join groups", () => {
    let s = line();
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate"], 0);
    const extra = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate"], 0);
    const tooMany = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate", "frigate", "frigate"], 0);
    s.fleets.push(fleet, extra, tooMany);
    s = run(s, form(s, fleet.id));
    s.fleets.find((f) => f.id === fleet.id)!.command!.cohesion = 100;
    expect(error(s, { type: "mergeFleets", empireId: 0, fleetId: fleet.id, intoFleetId: extra.id })).toBe("merge the group into the fleet instead");
    s = run(s, { type: "mergeFleets", empireId: 0, fleetId: extra.id, intoFleetId: fleet.id });
    expect(s.fleets.find((f) => f.id === fleet.id)!.command!.cohesion).toBe(80); // two ships, 10% each
    expect(error(s, { type: "mergeFleets", empireId: 0, fleetId: tooMany.id, intoFleetId: fleet.id })).toBe("not enough points in 1st Command");
    // The flagship stays with the fleet when ships are detached.
    const formed = s.fleets.find((f) => f.id === fleet.id)!;
    expect(error(s, { type: "splitFleet", empireId: 0, fleetId: fleet.id, shipIds: [formed.command!.flagshipId] })).toContain("flagship");
    s = run(s, { type: "splitFleet", empireId: 0, fleetId: fleet.id, shipIds: [formed.ships[3]!.id] });
    expect(s.fleets.at(-1)!.command).toBeNull();
  });

  it("dissolving returns the officer to the reserve with their experience, and they lead the next fleet", () => {
    let s = line();
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate"], 0);
    s.fleets.push(fleet);
    s = run(s, form(s, fleet.id));
    const officer = s.fleets.find((f) => f.id === fleet.id)!.command!.officer;
    s.fleets.find((f) => f.id === fleet.id)!.command!.officer.xp = 7;
    s = run(s, { type: "dissolveFleet", empireId: 0, fleetId: fleet.id });
    expect(s.fleets.find((f) => f.id === fleet.id)!.command).toBeNull();
    expect(s.empires[0]!.navalCommands[0]!.reserve).toEqual([{ ...officer, xp: 7 }]);
    s = run(s, form(s, fleet.id));
    expect(s.fleets.find((f) => f.id === fleet.id)!.command!.officer).toEqual({ ...officer, xp: 7 });
  });
});

describe("what groups and fleets may do", () => {
  it("armed groups can't enter systems with known enemies; fleets and unarmed groups can", () => {
    let s = line();
    const group = newFleet(s, pack, s.empires[0]!, ["frigate"], 0);
    const scout = newFleet(s, pack, s.empires[0]!, ["scout"], 0);
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate"], 0);
    s.fleets.push(group, scout, fleet);
    s = run(s, form(s, fleet.id));
    expect(knownHostileSystems(s, pack, 0).has(4)).toBe(true);
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: group.id, destinationId: 4 })).toContain("naval command");
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: group.id, destinationId: 3 })).toBe("ok");
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: scout.id, destinationId: 4 })).toBe("ok");
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: 4 })).toBe("ok");
  });

  it("an armed group may always go to its own colonies and outposts, around enemies if it can, else through", () => {
    const s = line();
    // A rival colony at 2 lies on the only way from 0 to our colony at 3.
    colonyAt(s, 3);
    s.empires[0]!.colonySightings.push({ ...s.empires[0]!.colonySightings[0]!, colonyId: 99_999, systemId: 2 });
    const group = newFleet(s, pack, s.empires[0]!, ["frigate"], 0);
    s.fleets.push(group);
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: group.id, destinationId: 3 })).toBe("ok");
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: group.id, destinationId: 2 })).toContain("naval command");
    // With a way around (0 - 1 - 3 directly), the route avoids system 2.
    s.galaxy.lanes.push({ a: 1, b: 3, length: 500 });
    chartAll(s);
    const result = applyCommand(s, { type: "moveFleet", empireId: 0, fleetId: group.id, destinationId: 3 }, pack);
    expect(result.ok && result.state.fleets.find((f) => f.id === group.id)!.route).toEqual([1, 3]);
  });

  it("an armed group halts before a system that turns hostile on its way, unless bound for its own colony", () => {
    let s = line();
    const group = newFleet(s, pack, s.empires[0]!, ["frigate"], 0);
    s.fleets.push(group);
    s = run(s, { type: "moveFleet", empireId: 0, fleetId: group.id, destinationId: 3 });
    // Enemies spotted at 2 after the order was given.
    s.empires[0]!.colonySightings.push({ ...s.empires[0]!.colonySightings[0]!, colonyId: 99_999, systemId: 2 });
    for (let i = 0; i < 3; i++) s = run(s, end);
    const halted = s.fleets.find((f) => f.id === group.id)!;
    expect(halted).toMatchObject({ systemId: 1, route: [], progress: 0 });
  });

  it("infiltrators (cloaked escorts or destroyers with commandos) may sneak in and sabotage without a fleet", () => {
    const s = line();
    const empire = s.empires[0]!;
    const colonyId = s.colonies[1]!.id;
    empire.designs.push(
      { id: "cloaked_destroyer", name: "Cloaked Destroyer", hull: "frigate", components: ["cloaking_device", "commando_team", "laser"], formation: "front", obsolete: false },
      { id: "cloaked_cruiser", name: "Cloaked Cruiser", hull: "cruiser", components: ["cloaking_device", "commando_team", "laser"], formation: "front", obsolete: false },
    );
    const sneak = (designs: string[]) => {
      const f = newFleet(s, pack, empire, designs, 3);
      s.fleets.push(f);
      const move: Command = { type: "moveFleet", empireId: 0, fleetId: f.id, destinationId: 4 };
      const moved = applyCommand(s, move, pack);
      // Sabotage needs the fleet at or bound for the target: check it after the move when there is one.
      const after = moved.ok ? moved.state : s;
      return { move: error(s, move), sabotage: error(after, { type: "sabotage", empireId: 0, fleetId: f.id, colonyId, mission: "defenses" }) };
    };
    expect(sneak(["infiltrator"])).toEqual({ move: "ok", sabotage: "ok" });
    expect(sneak(["cloaked_destroyer", "infiltrator"])).toEqual({ move: "ok", sabotage: "ok" });
    // Larger hulls don't qualify, and every ship must be cloaked.
    expect(sneak(["cloaked_cruiser"]).sabotage).toContain("naval command");
    expect(sneak(["infiltrator", "frigate"])).toEqual({ move: expect.stringContaining("naval command"), sabotage: expect.stringContaining("naval command") });
  });

  it("only fleets may invade, bomb or sabotage", () => {
    const s = line();
    const group = newFleet(s, pack, s.empires[0]!, ["frigate", "troop_transport"], 4);
    s.fleets.push(group);
    expect(error(s, { type: "invade", empireId: 0, fleetId: group.id, colonyId: s.colonies[1]!.id })).toContain("naval command");
  });

  it("a fleet commits to its course, and away from home can only head back to a colony or outpost", () => {
    let s = line();
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate"], 0);
    s.fleets.push(fleet);
    s = run(s, form(s, fleet.id), { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: 2 });
    // Still at home this turn: the order can be changed.
    s = run(s, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: 3 }, end);
    expect(s.fleets[0]!.progress).toBeGreaterThan(0);
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: 1 })).toContain("committed to its course");
    s = run(s, end, end, end, end, end);
    expect(s.fleets[0]).toMatchObject({ systemId: 3, route: [], progress: 0 });
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: 4 })).toContain("can only return");
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: 0 })).toBe("ok");
    // Subspace Command lifts both limits.
    s.empires[0]!.techs.push("subspace_command");
    expect(error(s, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: 4 })).toBe("ok");
  });

  it("changing flagship needs a colony or outpost (or Subspace Command) and costs cohesion", () => {
    let s = line();
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate"], 0);
    s.fleets.push(fleet);
    s = run(s, form(s, fleet.id));
    s.fleets[0]!.command!.cohesion = 100;
    s = run(s, { type: "setFlagship", empireId: 0, fleetId: fleet.id, shipId: fleet.ships[1]!.id });
    expect(s.fleets[0]!.command).toMatchObject({ flagshipId: fleet.ships[1]!.id, cohesion: 80 });
    s.fleets[0]!.systemId = 2;
    expect(error(s, { type: "setFlagship", empireId: 0, fleetId: fleet.id, shipId: fleet.ships[0]!.id })).toContain("colonies or outposts");
  });
});

describe("losses", () => {
  it("losing the flagship breaks the fleet up, and a new officer comes 5 turns later", () => {
    let s = line();
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate"], 0);
    s.fleets.push(fleet);
    s = run(s, form(s, fleet.id));
    s.fleets[0]!.ships = s.fleets[0]!.ships.slice(1); // the flagship is gone
    s = run(s, end);
    expect(s.fleets[0]!.command).toBeNull();
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "flagshipLost", fleetId: fleet.id, heldTogether: false }));
    const command = s.empires[0]!.navalCommands[0]!;
    expect(freeOfficers(s, pack, s.empires[0]!, command)).toBe(0);
    s = run(s, end, end, end, end);
    expect(freeOfficers(s, pack, s.empires[0]!, s.empires[0]!.navalCommands[0]!)).toBe(1);
  });

  it("a fleet wiped out costs its officer too", () => {
    let s = line();
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate"], 0);
    s.fleets.push(fleet);
    s = run(s, form(s, fleet.id));
    // A lone destroyer meets five enemy destroyers at home and fights to the last.
    s.fleets[0]!.orders = { ...s.fleets[0]!.orders, mission: "engage", retreatPercent: 100 };
    s.fleets[0]!.ships[0]!.hp = 1;
    const enemy = newFleet(s, pack, s.empires[1]!, ["frigate", "frigate", "frigate", "frigate", "frigate"], 0);
    enemy.orders = { ...enemy.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(enemy);
    s = run(s, end);
    expect(s.fleets.some((f) => f.id === fleet.id)).toBe(false);
    expect(s.empires[0]!.navalCommands[0]!.vacancies).toHaveLength(1);
  });

  it("a command that loses its home is displaced if the empire can still support it, then moved; else it is lost", () => {
    let s = line();
    for (const at of [1, 1, 2, 2, 3]) colonyAt(s, at);
    s = run(s, { type: "placeCommand", empireId: 0, commandId: null, systemId: 2 });
    const second = s.empires[0]!.navalCommands[1]!;
    // Lose both colonies at 2, keeping five colonies in all: still enough for two commands.
    colonyAt(s, 3);
    s.colonies = s.colonies.filter((c) => c.systemId !== 2);
    s = run(s, end);
    expect(s.empires[0]!.navalCommands[1]).toMatchObject({ id: second.id, homeSystemId: null });
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "commandDisplaced", commandId: second.id, systemId: 2 }));
    expect(error(s, { type: "placeCommand", empireId: 0, commandId: second.id, systemId: 0 })).toBe("another command is based there");
    s = run(s, { type: "placeCommand", empireId: 0, commandId: second.id, systemId: 3 });
    expect(s.empires[0]!.navalCommands[1]).toMatchObject({ homeSystemId: 3, readyTurn: s.turn + 5 });

    // Now lose the colonies at 3 too: three colonies are left, too few for two commands.
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate"], 3);
    s.fleets.push(fleet);
    s.fleets.at(-1)!.command = { commandId: second.id, officer: { id: 1, name: "X", xp: 0 }, flagshipId: fleet.ships[0]!.id, cohesion: 100 };
    s.colonies = s.colonies.filter((c) => c.systemId !== 3);
    s = run(s, end);
    expect(s.empires[0]!.navalCommands.map((c) => c.id)).not.toContain(second.id);
    expect(s.fleets.find((f) => f.id === fleet.id)!.command).toBeNull();
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "commandLost", commandId: second.id }));
  });
});

describe("outpost marks", () => {
  function withOutpost(): GameState {
    const s = line();
    s.galaxy.systems[1]!.bodies = [{ id: 9001, kind: "asteroids" }];
    s.outposts.push({ id: 7000, empireId: 0, systemId: 1, bodyId: 9001, kind: "combat", depot: false, mark: 0, defenseHp: 60 });
    s.empires[0]!.credits = 1000;
    return s;
  }
  const upgrade: Command = { type: "upgradeOutpostMark", empireId: 0, outpostId: 7000 };
  const weapons = pack.techs.filter((t) => t.field === "weapons").map((t) => t.id);

  it("unlock with weapons research, cost credits, and raise hit points, guns and upkeep", () => {
    let s = withOutpost();
    expect(error(s, upgrade)).toBe("needs 3 weapons techs (you have 0)");
    s.empires[0]!.techs.push(...weapons.slice(0, 3));
    const upkeep = outpostFinances(s, pack, 0).upkeep;
    s = run(s, upgrade);
    const outpost = s.outposts[0]!;
    expect(outpost).toMatchObject({ mark: 1, defenseHp: 60 + 40 });
    expect(s.empires[0]!.credits).toBe(1000 - 150);
    expect(outpostDefense(pack, s.empires[0]!, outpost)).toMatchObject({ maxHp: 100 });
    expect(outpostDefense(pack, s.empires[0]!, outpost).weapons).toHaveLength(3);
    expect(outpostFinances(s, pack, 0).upkeep).toBe(upkeep);
    expect(error(s, upgrade)).toBe("needs 5 weapons techs (you have 3)");
    s.empires[0]!.techs.push(...weapons.slice(3, 13));
    for (let i = 0; i < 4; i++) {
      s.empires[0]!.credits = 1000;
      s = run(s, upgrade);
    }
    expect(s.outposts[0]!.mark).toBe(5);
    expect(error(s, upgrade)).toBe("already at the highest mark");
  });

  it("need a clear way home: no known enemy fleet, outpost or colony on the route or at the outpost", () => {
    const s = withOutpost();
    s.empires[0]!.techs.push(...weapons.slice(0, 3));
    // Move the outpost out to 3: the way home passes 2.
    s.galaxy.systems[3]!.bodies.push({ id: 9003, kind: "asteroids" });
    Object.assign(s.outposts[0]!, { systemId: 3, bodyId: 9003 });
    expect(error(s, upgrade)).toBe("ok");
    s.empires[0]!.colonySightings.push({ ...s.empires[0]!.colonySightings[0]!, colonyId: 99_999, systemId: 2 });
    expect(error(s, upgrade)).toContain("cut off");
    s.empires[0]!.colonySightings.pop();
    s.empires[0]!.sightings.push({ fleetId: 5, empireId: 1, name: "Raiders", systemId: 3, nextSystemId: null, progress: 0, ships: 1, hull: "frigate", strength: 10, armed: true, turn: s.turn });
    expect(error(s, upgrade)).toContain("under threat");
  });
});

describe("saves from 1.4", () => {
  it("get commands at the capital and largest colonies, and their strongest armed fleets formed", () => {
    const s = line();
    for (const at of [1, 2, 3, 3]) colonyAt(s, at, 2);
    s.colonies.find((c) => c.systemId === 2)!.population = 9;
    const strong = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate", "frigate"], 0);
    const weak = newFleet(s, pack, s.empires[0]!, ["frigate"], 1);
    const settlers = newFleet(s, pack, s.empires[0]!, ["colony_ship"], 0);
    const weakest = newFleet(s, pack, s.empires[0]!, ["frigate"], 3);
    weakest.ships[0]!.hp = 1;
    s.fleets.push(strong, weak, settlers, weakest);
    // Turn it back into a version 17 save.
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & GameState;
    old.version = 17;
    for (const e of old.empires) delete (e as Partial<typeof e>).navalCommands;
    for (const f of old.fleets) delete (f as Partial<typeof f>).command;
    for (const o of old.outposts) delete (o as Partial<typeof o>).mark;
    const migrated = migrateState(old, pack);
    expect(migrated.version).toBe(18);
    const empire = migrated.empires[0]!;
    expect(empire.navalCommands.map((c) => c.homeSystemId)).toEqual([0, 2]);
    const formed = migrated.fleets.filter((f) => f.empireId === 0 && f.command).map((f) => f.id);
    expect(formed).toEqual([strong.id, weak.id]);
    expect(migrated.fleets.find((f) => f.id === strong.id)!.command).toMatchObject({ commandId: empire.navalCommands[0]!.id, cohesion: 100 });
  });
});

describe("in battle", () => {
  /** Empire 0's fleet (its first ship the flagship) against empire 1's ships at system 2, both fighting to the end. */
  function clash(ours: string[], theirs: string[], setup?: (s: GameState) => void): { s: GameState; fleetId: number; enemyId: number } {
    let s = line();
    for (const e of s.empires) e.designs.push({ id: "screen_gun", name: "Screen Gun", hull: "frigate", components: ["laser", "laser", "laser"], formation: "screen", obsolete: false });
    const fleet = enlist(s, newFleet(s, pack, s.empires[0]!, ours, 2));
    const enemy = newFleet(s, pack, s.empires[1]!, theirs, 2);
    for (const f of [fleet, enemy]) f.orders = { ...f.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(fleet, enemy);
    setup?.(s);
    s = run(s, end);
    return { s, fleetId: fleet.id, enemyId: enemy.id };
  }

  it("officers gain experience from battles, more from a win; ranks and cohesion change their fleet's aim", () => {
    const { s, fleetId } = clash(["frigate", "frigate", "frigate", "frigate"], ["frigate"]);
    const won = s.lastTurnEvents.some((e) => e.type === "battle" && e.empireId === 0 && e.outcome === "won");
    expect(s.fleets.find((f) => f.id === fleetId)!.command!.officer.xp).toBe(won ? 4 : 2);
    const fleet = s.fleets.find((f) => f.id === fleetId)!;
    fleet.command!.cohesion = 50;
    fleet.command!.officer.xp = 6;
    expect(leadership(pack, fleet)).toEqual({ bonus: 3, drill: 10 });
    fleet.command!.cohesion = 100;
    fleet.command!.officer.xp = 30;
    expect(leadership(pack, fleet)).toEqual({ bonus: 9, drill: 0 });
  });

  it("a fleet whose flagship is destroyed breaks up and falls back, and its officer is lost", () => {
    const { s, fleetId } = clash(["frigate", "frigate", "frigate"], Array.from({ length: 6 }, () => "frigate"), (s) => {
      s.empires[1]!.techs.push("command_ship_analysis");
      s.fleets[0]!.ships[0]!.hp = 1;
      s.fleets[1]!.orders.targetPriority = "flagship";
      enlist(s, s.fleets[1]!);
    });
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "flagshipLost", fleetId, heldTogether: false }));
    const broken = s.fleets.find((f) => f.id === fleetId);
    if (broken) {
      expect(broken.command).toBeNull();
      expect(s.lastBattles[0]!.results.find((r) => r.empireId === 0)!.retreated).toContain(fleetId);
    }
    expect(s.empires[0]!.navalCommands[0]!.vacancies).toHaveLength(1);
  });

  it("with Chain of Command the fleet holds together under its toughest ship", () => {
    const { s, fleetId } = clash(["frigate", "frigate", "frigate", "frigate"], ["frigate", "frigate"], (s) => {
      s.empires[0]!.techs.push("chain_of_command");
      s.empires[1]!.techs.push("command_ship_analysis");
      s.fleets[0]!.ships[0]!.hp = 1;
      s.fleets[1]!.orders.targetPriority = "flagship";
      enlist(s, s.fleets[1]!);
    });
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "flagshipLost", fleetId, heldTogether: true }));
    const fleet = s.fleets.find((f) => f.id === fleetId)!;
    expect(fleet.command).not.toBeNull();
    expect(fleet.ships.map((x) => x.id)).toContain(fleet.command!.flagshipId);
    expect(fleet.command!.cohesion).toBe(50 + 10); // back to 50%, then a turn's drill
    expect(s.empires[0]!.navalCommands[0]!.vacancies).toHaveLength(0);
  });

  it("flagship targeting aims every shot at the flagship; screening ships and decoys draw some away", () => {
    // Share of the shots from 6 enemy destroyers aiming at flagships that go for ours (made too tough to fall).
    const share = (escort: string, decoys: boolean) => {
      const { s, fleetId } = clash(["frigate", escort, escort, escort], Array.from({ length: 6 }, () => "frigate"), (s) => {
        s.empires[1]!.techs.push("command_ship_analysis");
        if (decoys) s.empires[0]!.techs.push("holographic_decoys");
        s.fleets[1]!.orders.targetPriority = "flagship";
        s.fleets[0]!.ships[0]!.hp = 10_000;
      });
      const report = s.lastBattles[0]!;
      const flagship = report.ships.find((x) => x.fleetId === fleetId)!.shipId;
      const shots = report.rounds.flatMap((r) => r.shots).filter((x) => report.ships.find((y) => y.shipId === x.attacker)!.empireId === 1);
      return shots.filter((x) => x.target === flagship).length / shots.length;
    };
    expect(share("frigate", false)).toBe(1);
    expect(share("screen_gun", false)).toBeLessThan(1);
    expect(share("frigate", true)).toBeLessThan(1);
  });

  it("the Flagship target priority needs Command Ship Analysis", () => {
    const s = line();
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate"], 0);
    s.fleets.push(fleet);
    const orders: Command = { type: "setFleetOrders", empireId: 0, fleetId: fleet.id, orders: { ...fleet.orders, targetPriority: "flagship" } };
    expect(error(s, orders)).toContain("Command Ship Analysis");
    s.empires[0]!.techs.push("command_ship_analysis");
    expect(error(s, orders)).toBe("ok");
  });
});

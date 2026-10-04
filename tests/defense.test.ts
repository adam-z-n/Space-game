import { chartAll } from "./helpers";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  colonyDefense,
  createInitialState,
  defendingTroops,
  fleetTroops,
  newFleet,
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
 * Line galaxy 0 - 1 - 2 - 3 - 4, lanes 200 long. Empire 0's capital at 0 (defended as at
 * game start), empire 1's capital at 4 on a terran world. Empire 0 has seen empire 1's capital.
 */
function line(): GameState {
  const s = createInitialState({ seed: "defense", galaxySize: "small", aiCount: 2 }, pack);
  s.galaxy.systems = s.galaxy.systems.slice(0, 5).map((x, i) => ({ ...x, id: i, x: i * 200, y: 0 }));
  s.galaxy.lanes = [0, 1, 2, 3].map((a) => ({ a, b: a + 1, length: 200 }));
  s.empires = s.empires.slice(0, 2);
  s.empires[0]!.homeSystemId = 0;
  s.empires[1]!.homeSystemId = 4;
  s.colonies = s.colonies.filter((c) => c.empireId < 2);
  s.colonies.forEach((c, i) => {
    c.systemId = i === 0 ? 0 : 4;
    c.bodyId = 7000 + i;
    s.galaxy.systems[c.systemId]!.bodies = [{ id: c.bodyId, kind: "planet", planetType: "terran", size: "medium", richness: "normal" }];
  });
  s.fleets = [];
  chartAll(s);
  const target = s.colonies[1]!;
  s.empires[0]!.colonySightings = [
    { colonyId: target.id, empireId: 1, systemId: 4, bodyId: target.bodyId, name: target.name, population: target.population, defenseHp: target.defenseHp, troops: 0, turn: 1 },
  ];
  return s;
}

const enemyCapital = (s: GameState) => s.colonies.find((c) => c.empireId === 1 && c.systemId === 4)!;

describe("colony defenses", () => {
  it("come from buildings and the colony's own batteries: capitals start with a platform and a garrison", () => {
    const s = line();
    const cap = enemyCapital(s);
    // Platform 40 hp and two guns, plus planetary batteries: 4 hp per population and a gun per 3 population.
    expect(colonyDefense(pack, s.empires[1]!, cap)).toMatchObject({ maxHp: 40 + 5 * 4, shield: 0, maxTroops: 8, mines: 0 });
    expect(colonyDefense(pack, s.empires[1]!, cap).weapons).toHaveLength(2 + 1);
    expect(cap.defenseHp).toBe(60);
    expect(defendingTroops(s, pack, cap)).toBe(8 + 5); // garrison + militia, no terrain bonus on terran
  });

  it("fight hostile ships in orbit, take damage, and stop a blockade while standing", () => {
    let s = line();
    s.fleets.push(newFleet(s, pack, s.empires[0]!, ["frigate"], 4));
    s = run(s, end);
    const report = s.lastBattles[0]!;
    expect(report.ships.some((x) => x.designName.startsWith("Defenses of"))).toBe(true);
    // The defenses took hits (they repair a little at the end of the turn).
    const hits = report.rounds.flatMap((r) => r.shots).filter((x) => x.target === enemyCapital(s).id && x.damage > 0);
    expect(hits.length).toBeGreaterThan(0);
    expect(enemyCapital(s).blockaded).toBe(false);
  });

  it("once knocked out, the colony is blockaded and doesn't repair under siege", () => {
    let s = line();
    s.fleets.push(newFleet(s, pack, s.empires[0]!, ["frigate", "frigate", "frigate", "frigate", "frigate"], 4));
    s.fleets[0]!.orders.retreatPercent = 100;
    let turns = 0;
    while (enemyCapital(s).defenseHp > 0 && turns++ < 10) s = run(s, end);
    expect(enemyCapital(s).defenseHp).toBe(0);
    expect(enemyCapital(s).blockaded).toBe(true);
    s = run(s, end);
    expect(enemyCapital(s).defenseHp).toBe(0);
  });

  it("terrain and ground tech raise defending troops", () => {
    const s = line();
    const cap = enemyCapital(s);
    s.galaxy.systems[4]!.bodies[0]!.planetType = "jungle"; // +30%
    expect(defendingTroops(s, pack, cap)).toBe(Math.floor(((8 + 5) * 130) / 100));
    s.empires[1]!.techs.push("ground_forces"); // +25%
    expect(defendingTroops(s, pack, cap)).toBe(Math.floor(((8 + 5) * 155) / 100));
  });
});

describe("invasion", () => {
  function besieged(troopShips: number): GameState {
    const s = line();
    const cap = enemyCapital(s);
    cap.defenseHp = 0;
    cap.buildings = cap.buildings.filter((b) => b !== "defense_platform");
    const army = newFleet(s, pack, s.empires[0]!, ["frigate", ...Array.from({ length: troopShips }, () => "troop_transport")], 4);
    s.fleets.push(army);
    return s;
  }

  it("needs troops, a known colony and the right system", () => {
    const s = besieged(0);
    const fleet = s.fleets[0]!;
    const cap = enemyCapital(s);
    expect(applyCommand(s, { type: "invade", empireId: 0, fleetId: fleet.id, colonyId: cap.id }, pack)).toMatchObject({ ok: false, error: "fleet carries no troops" });
    const t = besieged(2);
    t.empires[0]!.colonySightings = [];
    expect(applyCommand(t, { type: "invade", empireId: 0, fleetId: t.fleets[0]!.id, colonyId: cap.id }, pack)).toMatchObject({ ok: false, error: "no known rival colony there" });
  });

  it("captures a colony when the landing force wins, spending the transports", () => {
    let s = besieged(4); // 40 troops vs 13 defenders
    const fleet = s.fleets[0]!;
    const cap = enemyCapital(s);
    expect(fleetTroops(s, pack, fleet)).toBe(40);
    s = run(s, { type: "invade", empireId: 0, fleetId: fleet.id, colonyId: cap.id }, end);
    const taken = s.colonies.find((c) => c.id === cap.id)!;
    expect(taken.empireId).toBe(0);
    expect(taken.capital).toBe(false);
    expect(taken.buildings).not.toContain("capitol");
    expect(taken.population).toBeLessThan(5);
    expect(s.fleets.find((f) => f.id === fleet.id)!.ships.map((x) => x.designId)).toEqual(["frigate"]);
    const events = s.lastTurnEvents.filter((e) => e.type === "invasion");
    expect(events.map((e) => e.empireId).sort()).toEqual([0, 1]);
    expect(events[0]).toMatchObject({ captured: true, attackerId: 0, defenderId: 1 });
    // Empire 1 had no other colony: it is eliminated, and with two empires the game is won.
    expect(s.empires[1]!.eliminated).toBe(true);
    expect(s.outcome).toMatchObject({ winnerId: 0, reason: "elimination" });
  });

  it("is repelled when the defenders are stronger", () => {
    let s = besieged(1); // 5 troops vs 13
    const cap = enemyCapital(s);
    s = run(s, { type: "invade", empireId: 0, fleetId: s.fleets[0]!.id, colonyId: cap.id }, end);
    expect(s.colonies.find((c) => c.id === cap.id)!.empireId).toBe(1);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "invasion", captured: false, empireId: 0 }));
  });

  it("can't land while orbital defenses still stand: the transports withdraw under fire", () => {
    let s = besieged(4);
    const cap = enemyCapital(s);
    cap.buildings.push("defense_platform");
    cap.defenseHp = 500; // can't be knocked out this turn
    s = run(s, { type: "invade", empireId: 0, fleetId: s.fleets[0]!.id, colonyId: cap.id }, end);
    expect(s.colonies.find((c) => c.id === cap.id)!.empireId).toBe(1);
    expect(s.lastTurnEvents.some((e) => e.type === "invasion")).toBe(false);
    const transports = s.fleets.find((f) => f.empireId === 0)!;
    expect(transports.invadeColonyId).toBeNull();
    expect(transports.route.length).toBeGreaterThan(0);
  });

  it("moving cancels the order", () => {
    let s = besieged(2);
    const fleet = s.fleets[0]!;
    s = run(s, { type: "invade", empireId: 0, fleetId: fleet.id, colonyId: enemyCapital(s).id }, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: 3 });
    expect(s.fleets[0]!.invadeColonyId).toBeNull();
  });

  it("losing the capital moves it to the largest remaining colony", () => {
    let s = besieged(4);
    const spare = { ...enemyCapital(s), id: 8800, capital: false, systemId: 3, bodyId: 8801, population: 3, buildings: [], defenseHp: 0, troops: 0 };
    s.galaxy.systems[3]!.bodies = [{ id: 8801, kind: "planet", planetType: "arid", size: "small", richness: "normal" }];
    s.colonies.push(spare);
    s = run(s, { type: "invade", empireId: 0, fleetId: s.fleets[0]!.id, colonyId: enemyCapital(s).id }, end);
    const moved = s.colonies.find((c) => c.id === 8800)!;
    expect(moved.capital).toBe(true);
    expect(moved.buildings).toContain("capitol");
    expect(s.empires[1]!.homeSystemId).toBe(3);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "capitalMoved", empireId: 1, colonyId: 8800 }));
  });
});

describe("support ships", () => {
  it("minelayers mine the system they wait in, and mines hit hostile ships there", () => {
    let s = line();
    s.empires[0]!.techs.push("mine_warfare");
    s.fleets.push(newFleet(s, pack, s.empires[0]!, ["minelayer"], 2));
    s = run(s, end);
    expect(s.minefields).toContainEqual({ systemId: 2, empireId: 0, strength: 20 });
    const victims = newFleet(s, pack, s.empires[1]!, Array.from({ length: 10 }, () => "frigate"), 2);
    victims.orders.mission = "evade";
    s.fleets.push(victims);
    const before = victims.ships.reduce((n, x) => n + x.hp, 0);
    s = run(s, end);
    const hit = s.lastTurnEvents.find((e) => e.type === "mineHits" && e.empireId === 1);
    expect(hit).toBeDefined();
    const after = s.fleets.find((f) => f.id === victims.id)!.ships.reduce((n, x) => n + x.hp, 0);
    expect(after).toBeLessThan(before);
  });

  it("repair tenders mend their fleet outside supply", () => {
    let s = line();
    s.empires[0]!.techs.push("field_repair", "automation");
    const fleet = newFleet(s, pack, s.empires[0]!, ["frigate", "repair_tender"], 3); // system 3 is outside supply
    fleet.ships[0]!.hp = 10;
    s.fleets.push(fleet);
    s = run(s, end);
    expect(s.fleets[0]!.ships[0]!.hp).toBe(10 + Math.ceil((26 * 15) / 100));
  });
});

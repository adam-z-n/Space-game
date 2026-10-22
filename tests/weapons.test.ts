import { describe, expect, it } from "vitest";
import { applyCommand, createInitialState, designStats, empireEffects, newFleet, type BattleShot, type Command, type GameState } from "../src/core";
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

/** Line galaxy 0 - 1 - ... - 6; empire 0's capital at 0, empire 1's at 6. No fleets. */
function line(): GameState {
  const state = createInitialState({ seed: "weapons", galaxySize: "small", aiCount: 2 }, pack);
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

/** Give empire 0 a design and put `count` of them at `systemId`, never retreating. */
function armed(s: GameState, hull: string, components: string[], count: number, systemId = 3) {
  s.empires[0]!.designs.push({ id: "test", name: "Test", hull, components, formation: "front", obsolete: false });
  const fleet = newFleet(s, pack, s.empires[0]!, Array.from({ length: count }, () => "test"), systemId);
  fleet.orders = { ...fleet.orders, retreatPercent: 100 };
  s.fleets.push(fleet);
  return fleet;
}

/** Empire 1 ships as slow as `hull`, so the range closes (nimble frigates would keep out of reach). */
function slow(s: GameState, hull: string, count: number): string[] {
  s.empires[1]!.designs.push({ id: `slow_${hull}`, name: "Slow", hull, components: ["laser", "armor_plating"], formation: "front", obsolete: false });
  return Array.from({ length: count }, () => `slow_${hull}`);
}

function enemy(s: GameState, designs: string[], systemId = 3) {
  const fleet = newFleet(s, pack, s.empires[1]!, designs, systemId);
  s.fleets.push(fleet);
  return fleet;
}

const allShots = (s: GameState): BattleShot[] => s.lastBattles.flatMap((b) => b.rounds.flatMap((r) => [...r.shots, ...r.pursuit]));

describe("new weapons", () => {
  it("graviton lances pin the enemy fleet: it can't withdraw", () => {
    const s = line();
    armed(s, "cruiser", ["graviton_lance", "graviton_lance", "graviton_lance", "graviton_lance", "graviton_lance"], 3);
    const target = enemy(s, slow(s, "cruiser", 6));
    target.orders.retreatPercent = 1; // would flee at the first scratch
    const t = run(s, end);
    expect(allShots(t).some((x) => x.effect === "pin")).toBe(true);
    expect(t.lastBattles[0]!.rounds.flatMap((r) => r.retreated)).not.toContain(target.id);
  });

  it("EMP torpedoes knock out a part with every hit", () => {
    const s = line();
    armed(s, "cruiser", ["emp_torpedo", "emp_torpedo", "emp_torpedo", "emp_torpedo", "laser"], 2);
    enemy(s, ["frigate", "frigate"]);
    const t = run(s, end);
    const emp = allShots(t).filter((x) => x.effect === "emp");
    expect(emp.length).toBeGreaterThan(0);
    expect(emp[0]!.destroyed || !!emp[0]!.knockedOut).toBe(true); // the first hit always finds a working part
  });

  it("nanites keep eating a ship in later rounds", () => {
    const s = line();
    armed(s, "cruiser", ["nanite_swarm", "nanite_swarm", "armor_plating", "armor_plating", "armor_plating"], 1);
    s.empires[1]!.designs.push({ id: "tank", name: "Tank", hull: "cruiser", components: ["armor_plating", "armor_plating", "armor_plating", "armor_plating", "laser"], formation: "front", obsolete: false });
    const target = enemy(s, ["tank"]);
    target.orders.retreatPercent = 100;
    const t = run(s, end);
    expect(allShots(t).some((x) => x.effect === "corrode")).toBe(true);
  });

  it("a singularity charge strikes every ship in the target's fleet", () => {
    const s = line();
    s.empires[0]!.techs.push("capital_ships");
    armed(s, "battleship", ["singularity_charge", "singularity_charge", "singularity_charge", "armor_plating", "armor_plating", "armor_plating"], 2);
    enemy(s, slow(s, "battleship", 5));
    const t = run(s, end);
    const report = t.lastBattles[0]!;
    const round = report.rounds.find((r) => r.shots.some((x) => x.effect === "area"))!;
    const struck = new Set(round.shots.filter((x) => x.effect === "area").map((x) => x.target));
    expect(struck.size).toBeGreaterThan(1);
  });

  it("ion cannons wear down shields instead of the hull", () => {
    const s = line();
    armed(s, "cruiser", ["ion_cannon", "ion_cannon", "ion_cannon", "ion_cannon", "ion_cannon"], 2);
    enemy(s, slow(s, "cruiser", 2));
    const t = run(s, end);
    const ion = allShots(t).filter((x) => x.effect === "ion");
    expect(ion.length).toBeGreaterThan(0);
    expect(ion.every((x) => x.damage === 0 && x.shieldDamage === 5)).toBe(true);
  });

  it("point defense can't stop phase torpedoes, and flak batteries count as point defense", () => {
    const s = line();
    armed(s, "cruiser", ["phase_torpedo", "phase_torpedo", "phase_torpedo", "phase_torpedo", "phase_torpedo"], 2);
    s.empires[1]!.designs.push({ id: "flak", name: "Flak", hull: "cruiser", components: ["flak_battery", "flak_battery", "flak_battery", "flak_battery", "flak_battery"], formation: "front", obsolete: false });
    expect(designStats(pack, s.empires[1]!.designs.at(-1)!, empireEffects(pack, s.empires[1]!)).pointDefense).toBe(10);
    enemy(s, ["flak", "flak"]);
    const t = run(s, end);
    expect(allShots(t).some((x) => x.intercepted)).toBe(false);
  });

  it("mass accelerator mines hit twice as hard and knock out parts", () => {
    const normal = line();
    normal.minefields.push({ systemId: 3, empireId: 0, strength: 100 });
    const victims = enemy(normal, Array.from({ length: 10 }, () => "frigate"));
    victims.orders.mission = "evade";
    const heavy = structuredClone(normal);
    heavy.empires[0]!.techs.push("mass_accelerator_mines");
    const hpLost = (s: GameState) => {
      const before = s.fleets.find((f) => f.id === victims.id)!.ships.reduce((n, x) => n + x.hp, 0);
      const t = run(s, end);
      const after = t.fleets.find((f) => f.id === victims.id)?.ships.reduce((n, x) => n + x.hp, 0) ?? 0;
      return { lost: before - after, damaged: t.fleets.find((f) => f.id === victims.id)?.ships.some((x) => x.damaged.length > 0) ?? false };
    };
    const a = hpLost(normal);
    const b = hpLost(heavy);
    expect(b.lost).toBeGreaterThan(a.lost);
    expect(a.damaged).toBe(false);
    expect(b.damaged).toBe(true);
  });

  it("hunter-killer satellites fire on enemy ships in orbit even with the defenses down", () => {
    let s = line();
    const home = s.colonies.find((c) => c.empireId === 1)!;
    home.buildings.push("hunter_killer_satellites");
    home.defenseHp = 0;
    const raiders = armed(s, "frigate", ["laser", "laser", "armor_plating"], 3, 6);
    const before = raiders.ships.reduce((n, x) => n + x.hp, 0);
    s = run(s, end);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "satelliteStrikes", empireId: 0, colonyId: home.id, targetEmpireId: 0 }));
    const after = s.fleets.find((f) => f.id === raiders.id)?.ships.reduce((n, x) => n + x.hp, 0) ?? 0;
    expect(after).toBeLessThan(before);
  });
});

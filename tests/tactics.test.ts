import { chartAll } from "./helpers";
import { describe, expect, it } from "vitest";
import { applyCommand, createInitialState, defendingTroops, newFleet, type BattleReport, type Command, type Formation, type GameState } from "../src/core";
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

/** Line galaxy 0 - 1 - ... - 6 (lanes 200), capitals at 0 and 6, no fleets. */
function line(): GameState {
  const state = createInitialState({ seed: "tactics", galaxySize: "small", aiCount: 2 }, pack);
  state.galaxy.systems = state.galaxy.systems.slice(0, 7).map((s, i) => ({ ...s, id: i, x: i * 200, y: 0 }));
  state.galaxy.lanes = [0, 1, 2, 3, 4, 5].map((a) => ({ a, b: a + 1, length: 200 }));
  state.empires = state.empires.slice(0, 2);
  state.empires[0]!.homeSystemId = 0;
  state.empires[1]!.homeSystemId = 6;
  state.colonies = state.colonies.filter((c) => c.empireId < 2 && c.capital);
  state.colonies[0]!.systemId = 0;
  state.colonies[1]!.systemId = 6;
  for (const c of state.colonies) {
    c.bodyId = 8000 + c.empireId;
    state.galaxy.systems[c.systemId]!.bodies = [{ id: c.bodyId, kind: "planet", planetType: "terran", size: "medium", richness: "normal" }];
  }
  state.fleets = [];
  chartAll(state);
  return state;
}

/** Give both empires a design (techs aren't checked for test designs). */
function design(state: GameState, id: string, hull: string, components: string[], formation: Formation = "front"): void {
  for (const empire of state.empires) empire.designs.push({ id, name: id, hull, components, formation, obsolete: false });
}

function battle(state: GameState): BattleReport {
  const report = state.lastBattles[0];
  if (!report) throw new Error("no battle");
  return report;
}

const shotsBy = (report: BattleReport, shipIds: Set<number>) => report.rounds.flatMap((r) => r.shots).filter((s) => shipIds.has(s.attacker));

describe("battle range", () => {
  it("lets the more maneuverable side keep the range that suits it", () => {
    let s = line();
    // Nimble missile boats against slow short-range brawlers.
    design(s, "kiter", "corvette", ["torpedo", "torpedo"]);
    design(s, "brawler", "battleship", Array.from({ length: 8 }, () => "mass_driver"));
    const kiters = newFleet(s, pack, s.empires[0]!, ["kiter", "kiter", "kiter"], 3);
    const brawler = newFleet(s, pack, s.empires[1]!, ["brawler"], 3);
    kiters.orders = { ...kiters.orders, mission: "engage", retreatPercent: 100 };
    brawler.orders = { ...brawler.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(kiters, brawler);
    s = run(s, end);
    const report = battle(s);
    expect(report.rounds.every((r) => r.range === 3)).toBe(true);
    expect(shotsBy(report, new Set(brawler.ships.map((x) => x.id)))).toHaveLength(0); // never in reach
    expect(shotsBy(report, new Set(kiters.ships.map((x) => x.id))).length).toBeGreaterThan(0);
  });

  it("closes when the faster side wants a knife fight", () => {
    let s = line();
    design(s, "dasher", "corvette", ["mass_driver", "mass_driver"]);
    design(s, "sniper", "battleship", Array.from({ length: 8 }, () => "torpedo"));
    const dashers = newFleet(s, pack, s.empires[0]!, ["dasher", "dasher", "dasher", "dasher"], 3);
    const sniper = newFleet(s, pack, s.empires[1]!, ["sniper"], 3);
    for (const f of [dashers, sniper]) f.orders = { ...f.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(dashers, sniper);
    s = run(s, end);
    const ranges = battle(s).rounds.map((r) => r.range);
    expect(ranges.slice(0, 3)).toEqual([3, 2, 1]);
  });
});

describe("formations and special weapons", () => {
  it("screens take fire meant for support ships; fighters slip past", () => {
    const fired = (weapon: string) => {
      let s = line();
      design(s, "gunboat", "cruiser", [weapon, weapon, weapon, weapon, weapon]);
      design(s, "tender", "transport", ["armor_plating", "armor_plating"], "support");
      // The defenders carry one gun, or they would slip away after the first round.
      design(s, "picket", "battleship", ["laser", ...Array.from({ length: 7 }, () => "composite_armor")], "screen");
      const attackers = newFleet(s, pack, s.empires[0]!, ["gunboat", "gunboat"], 3);
      const defenders = newFleet(s, pack, s.empires[1]!, ["tender", "picket"], 3);
      attackers.orders = { ...attackers.orders, mission: "engage", retreatPercent: 100, targetPriority: "transports" };
      defenders.orders = { ...defenders.orders, mission: "engage", retreatPercent: 100 };
      s.fleets.push(attackers, defenders);
      s = run(s, end);
      const tender = defenders.ships[0]!.id;
      // The first round with any fire (lasers wait for medium range), before the transport can die.
      const shots = battle(s).rounds.find((r) => r.shots.length > 0)!.shots;
      return shots.filter((x) => x.target === tender).length / shots.length;
    };
    // Lasers aimed at the transport are often taken by the screen; fighters hunt it down.
    expect(fired("fighter_bay")).toBeGreaterThan(fired("laser") + 0.15);
  });

  it("point defense shoots down missiles, and piercing weapons ignore shields", () => {
    let s = line();
    design(s, "launcher", "battleship", Array.from({ length: 8 }, () => "torpedo"));
    design(s, "pd", "battleship", ["point_defense", "point_defense", "point_defense", "point_defense", "hardened_shield", "hardened_shield", "composite_armor", "composite_armor"]);
    const launcher = newFleet(s, pack, s.empires[0]!, ["launcher"], 3);
    const target = newFleet(s, pack, s.empires[1]!, ["pd"], 3);
    for (const f of [launcher, target]) f.orders = { ...f.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(launcher, target);
    s = run(s, end);
    expect(battle(s).rounds.flatMap((r) => r.shots).some((x) => x.intercepted)).toBe(true);

    let p = line();
    design(p, "gauss", "battleship", Array.from({ length: 8 }, () => "gauss_cannon"));
    design(p, "wall", "battleship", ["laser", ...Array.from({ length: 7 }, () => "deflector_v")]);
    const gun = newFleet(p, pack, p.empires[0]!, ["gauss"], 3);
    const wall = newFleet(p, pack, p.empires[1]!, ["wall"], 3);
    for (const f of [gun, wall]) f.orders = { ...f.orders, mission: "engage", retreatPercent: 100, stance: "balanced" };
    p.fleets.push(gun, wall);
    p = run(p, end);
    const hits = battle(p).rounds.flatMap((r) => r.shots).filter((x) => x.attacker !== wall.ships[0]!.id && x.damage > 0);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((x) => x.damage === 9)).toBe(true); // full damage through Deflector V
  });
});

describe("retreat and passage", () => {
  it("retreats toward a friendly or empty system, never into an enemy colony", () => {
    let s = line();
    // A rival colony at 2 sits between the battle at 3 and home at 0; the fleet should fall back to 4.
    s.colonies.push({ ...s.colonies[1]!, id: 9100, systemId: 2, bodyId: 9101, capital: false, buildings: [] });
    s.galaxy.systems[2]!.bodies = [{ id: 9101, kind: "planet", planetType: "terran", size: "medium", richness: "normal" }];
    s.empires[0]!.colonySightings = [{ colonyId: 9100, empireId: 1, systemId: 2, bodyId: 9101, name: "Outpost", population: 5, defenseHp: 0, troops: 0, turn: 1 }];
    const scout = newFleet(s, pack, s.empires[0]!, ["scout"], 3);
    const enemy = newFleet(s, pack, s.empires[1]!, ["frigate", "frigate"], 3);
    enemy.orders = { ...enemy.orders, mission: "engage" };
    s.fleets.push(scout, enemy);
    s = run(s, end);
    const fled = s.fleets.find((f) => f.id === scout.id);
    if (fled) expect(fled.route[fled.route.length - 1]).toBe(4);
  });

  it("any armed enemy fleet stops ships passing through its system, even on evade orders", () => {
    let s = line();
    const runner = newFleet(s, pack, s.empires[0]!, ["scout"], 2);
    const picket = newFleet(s, pack, s.empires[1]!, ["frigate"], 3);
    picket.orders = { ...picket.orders, mission: "evade" };
    s.fleets.push(runner, picket);
    s = run(s, { type: "moveFleet", empireId: 0, fleetId: runner.id, destinationId: 5 }, end); // partway along the lane
    s = run(s, end);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "fleetIntercepted", fleetId: runner.id, systemId: 3 }));
  });
});

describe("ground war", () => {
  it("a failed invasion costs the defenders troops that take turns to come back", () => {
    let s = line();
    const cap = s.colonies.find((c) => c.empireId === 1)!;
    cap.defenseHp = 0;
    cap.buildings = cap.buildings.filter((b) => b === "capitol" || b === "garrison");
    s.empires[0]!.colonySightings = [{ colonyId: cap.id, empireId: 1, systemId: 6, bodyId: cap.bodyId, name: cap.name, population: 5, defenseHp: 0, troops: 13, turn: 1 }];
    const army = newFleet(s, pack, s.empires[0]!, ["frigate", "troop_transport"], 6);
    army.orders = { ...army.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(army);
    const before = defendingTroops(s, pack, cap);
    s = run(s, { type: "invade", empireId: 0, fleetId: army.id, colonyId: cap.id }, end);
    const after = s.colonies.find((c) => c.id === cap.id)!;
    expect(after.empireId).toBe(1);
    expect(after.militiaLosses).toBeGreaterThan(0);
    expect(defendingTroops(s, pack, after)).toBeLessThan(before);
  });

  it("bombardment kills population once the defenses are down, but never the last of it", () => {
    let s = line();
    design(s, "bomber", "cruiser", ["bomb_bay", "bomb_bay", "bomb_bay", "laser", "laser"]);
    const cap = s.colonies.find((c) => c.empireId === 1)!;
    cap.buildings = ["capitol"];
    cap.defenseHp = 0;
    s.empires[0]!.colonySightings = [{ colonyId: cap.id, empireId: 1, systemId: 6, bodyId: cap.bodyId, name: cap.name, population: 5, defenseHp: 0, troops: 5, turn: 1 }];
    const bombers = newFleet(s, pack, s.empires[0]!, ["bomber", "bomber", "bomber"], 6);
    bombers.orders = { ...bombers.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(bombers);
    s = run(s, { type: "bombard", empireId: 0, fleetId: bombers.id, colonyId: cap.id }, end);
    const hit = s.colonies.find((c) => c.id === cap.id)!;
    expect(hit.population).toBeLessThan(5);
    expect(s.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "bombarded", empireId: 1, colonyId: cap.id }));
    for (let i = 0; i < 5; i++) s = run(s, end);
    expect(s.colonies.find((c) => c.id === cap.id)!.population).toBeGreaterThanOrEqual(1);
    expect(applyCommand(s, { type: "bombard", empireId: 0, fleetId: s.fleets.find((f) => f.empireId === 0 && f.ships.length > 0)!.id, colonyId: null }, pack).ok).toBe(true);
  });
});

describe("experience and command", () => {
  it("ranks are worth more on big hulls", async () => {
    const { veteranBonus } = await import("../src/core");
    expect(veteranBonus(pack, "corvette", 0)).toBe(0);
    expect(veteranBonus(pack, "corvette", 25)).toBe(4); // Ace: rank 4 x 1
    expect(veteranBonus(pack, "dreadnought", 25)).toBe(20); // Ace: rank 4 x 5
    expect(veteranBonus(pack, "cruiser", 8)).toBe(6); // Veteran: rank 2 x 3
  });

  it("ships that survive a battle gain experience, more for kills and long odds", () => {
    let s = line();
    const strong = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate", "frigate", "frigate"], 3);
    const weak = newFleet(s, pack, s.empires[1]!, ["frigate"], 3);
    for (const f of [strong, weak]) f.orders = { ...f.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(strong, weak);
    s = run(s, end);
    const ships = s.fleets.find((f) => f.id === strong.id)!.ships;
    expect(ships.every((x) => x.xp >= pack.combat.xpPerBattle)).toBe(true);
    expect(ships.some((x) => x.xp >= pack.combat.xpPerBattle + pack.combat.xpPerKill)).toBe(true);
  });

  it("a military academy trains new crews", () => {
    let s = line();
    const cap = s.colonies.find((c) => c.empireId === 0)!;
    cap.buildings.push("military_academy");
    cap.queue = [{ kind: "ship", id: "frigate" }];
    cap.progress = 1000;
    s = run(s, end);
    const built = s.fleets.find((f) => f.empireId === 0)!;
    expect(built.ships[0]!.xp).toBe(3);
  });

  it("a command network makes its whole fleet hit more often", () => {
    const hitRate = (withCommand: boolean) => {
      let s = line();
      design(s, "flag", "battleship", [withCommand ? "command_network" : "composite_armor", ...Array.from({ length: 7 }, () => "composite_armor")]);
      design(s, "gunboat", "frigate", ["laser", "laser", "laser"]);
      design(s, "target", "dreadnought", ["laser", ...Array.from({ length: 11 }, () => "crystalline_armor")]);
      const fleet = newFleet(s, pack, s.empires[0]!, ["flag", ...Array.from({ length: 6 }, () => "gunboat")], 3);
      const target = newFleet(s, pack, s.empires[1]!, ["target", "target"], 3);
      for (const f of [fleet, target]) f.orders = { ...f.orders, mission: "engage", retreatPercent: 100 };
      s.fleets.push(fleet, target);
      s = run(s, end);
      const mine = new Set(fleet.ships.map((x) => x.id));
      const shots = battle(s).rounds.flatMap((r) => r.shots).filter((x) => mine.has(x.attacker));
      return shots.filter((x) => x.damage > 0).length / shots.length;
    };
    expect(hitRate(true)).toBeGreaterThan(hitRate(false));
  });
});

describe("1.2 combat extras", () => {
  it("missile launchers run dry after their salvos until rearmed at a colony", () => {
    let s = line();
    design(s, "launcher", "battleship", Array.from({ length: 8 }, () => "torpedo"));
    design(s, "wall", "dreadnought", ["laser", ...Array.from({ length: 11 }, () => "crystalline_armor")]);
    const launcher = newFleet(s, pack, s.empires[0]!, ["launcher"], 3);
    const wall = newFleet(s, pack, s.empires[1]!, ["wall"], 3);
    for (const f of [launcher, wall]) f.orders = { ...f.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(launcher, wall);
    s = run(s, end);
    const launcherShip = launcher.ships[0]!.id;
    // Eight launchers, three salvos each (parting shots at a fleeing target spend salvos too).
    const torpedoes = battle(s).rounds.flatMap((r) => [...r.shots, ...r.pursuit]).filter((x) => x.attacker === launcherShip);
    expect(torpedoes).toHaveLength(8 * 3);
    expect(s.fleets.find((f) => f.id === launcher.id)!.ships[0]!.salvos).toBe(3);
    s.fleets.find((f) => f.id === launcher.id)!.systemId = 0;
    s = run(s, end);
    expect(s.fleets.find((f) => f.id === launcher.id)!.ships[0]!.salvos).toBe(0);
  });

  it("heavy hits knock out components, which stay out until repaired at a colony", () => {
    let s = line();
    design(s, "hammer", "dreadnought", Array.from({ length: 12 }, () => "starburst_torpedo"));
    design(s, "victim", "cruiser", ["laser", "laser", "deflector", "afterburner", "composite_armor"]);
    const hammer = newFleet(s, pack, s.empires[0]!, ["hammer"], 3);
    const victims = newFleet(s, pack, s.empires[1]!, Array.from({ length: 6 }, () => "victim"), 3);
    for (const f of [hammer, victims]) f.orders = { ...f.orders, mission: "engage", retreatPercent: 100 };
    s.fleets.push(hammer, victims);
    s = run(s, end);
    const knocked = battle(s).rounds.flatMap((r) => r.shots).filter((x) => x.knockedOut);
    expect(knocked.length).toBeGreaterThan(0);
    const survivors = s.fleets.find((f) => f.id === victims.id);
    const damaged = survivors?.ships.filter((x) => x.damaged.length > 0) ?? [];
    if (damaged.length > 0) {
      survivors!.systemId = 6; // home colony
      s = run(s, end);
      expect(s.fleets.find((f) => f.id === victims.id)!.ships.every((x) => x.damaged.length === 0)).toBe(true);
    }
  });

  it("faster enemies take parting shots at a retreating fleet; hit-and-run training avoids them", () => {
    const parting = (hitAndRun: boolean) => {
      let s = line();
      design(s, "hunter", "corvette", ["laser", "laser"]);
      design(s, "lumber", "battleship", ["laser", ...Array.from({ length: 7 }, () => "armor_plating")]);
      if (hitAndRun) s.empires[1]!.techs.push("hit_and_run");
      const hunters = newFleet(s, pack, s.empires[0]!, Array.from({ length: 6 }, () => "hunter"), 3);
      const slow = newFleet(s, pack, s.empires[1]!, ["lumber"], 3);
      hunters.orders = { ...hunters.orders, mission: "engage", retreatPercent: 100 };
      slow.orders = { ...slow.orders, mission: "engage", retreatPercent: 1 };
      s.fleets.push(hunters, slow);
      s = run(s, end);
      return battle(s).rounds.flatMap((r) => r.pursuit).length;
    };
    expect(parting(false)).toBeGreaterThan(0);
    expect(parting(true)).toBe(0);
  });

  it("oversized fleets fight less well together", () => {
    const hitRate = (size: number) => {
      let s = line();
      design(s, "target", "dreadnought", ["laser", ...Array.from({ length: 11 }, () => "crystalline_armor")]);
      const fleet = newFleet(s, pack, s.empires[0]!, Array.from({ length: size }, () => "frigate"), 3);
      const target = newFleet(s, pack, s.empires[1]!, ["target", "target"], 3);
      for (const f of [fleet, target]) f.orders = { ...f.orders, mission: "engage", retreatPercent: 100 };
      s.fleets.push(fleet, target);
      s = run(s, end);
      const mine = new Set(fleet.ships.map((x) => x.id));
      const shots = battle(s).rounds.flatMap((r) => r.shots).filter((x) => mine.has(x.attacker));
      return shots.filter((x) => x.damage > 0).length / shots.length;
    };
    expect(hitRate(16)).toBeLessThan(hitRate(8));
  });
});

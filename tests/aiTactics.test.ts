import { describe, expect, it } from "vitest";
import { buildContext, createInitialState, decideStrategy, newFleet, planAiTurn, type Command, type GameState } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";
import { chartAll } from "./helpers";

const pack = defaultPack();

/**
 * Empire 1 (a warlord AI) with a strong fleet at home, at war with empire 2, whose capital it has
 * seen with `defenseHp` standing and `troops` defenders.
 */
function atWar(defenseHp: number, troops: number): GameState {
  const s = createInitialState({ seed: "ai-tactics", galaxySize: "small", aiCount: 2 }, pack);
  const ai = s.empires[1]!;
  ai.personality = "warlord";
  ai.techs.push("cruiser_hulls", "orbital_bombardment", "special_operations", "cloaking");
  ai.designs.push({ id: "siege", name: "Siege Mk 1", hull: "cruiser", components: ["bomb_bay", "bomb_bay", "laser", "laser", "armor_plating"], formation: "front", obsolete: false });
  s.turn = 100;
  chartAll(s);
  s.fleets.push(newFleet(s, pack, ai, Array.from({ length: 8 }, () => "frigate"), ai.homeSystemId));
  const target = s.colonies.find((c) => c.empireId === 2 && c.capital)!;
  target.defenseHp = defenseHp;
  ai.colonySightings = [{ colonyId: target.id, empireId: 2, systemId: target.systemId, bodyId: target.bodyId, name: target.name, population: target.population, defenseHp, troops, turn: s.turn }];
  return s;
}
/** `n` more big colonies for empire 1 in its home system, to build with. */
function moreColonies(s: GameState, n: number): void {
  const capital = s.colonies.find((c) => c.empireId === 1 && c.capital)!;
  for (let i = 1; i <= n; i++) {
    s.galaxy.systems[capital.systemId]!.bodies.push({ id: 9000 + i, kind: "planet", planetType: "terran", size: "medium", richness: "normal" });
    s.colonies.push({ ...capital, id: 9100 + i, capital: false, bodyId: 9000 + i, buildings: [], queue: [] });
  }
}
const target = (s: GameState) => s.colonies.find((c) => c.empireId === 2 && c.capital)!;
const ordersFor = (commands: Command[], fleetId: number) => commands.filter((c) => "fleetId" in c && c.fleetId === fleetId);

describe("AI siege tactics", () => {
  it("bombards a colony whose defenses are down while its troops in orbit are too few, and stops once they suffice", () => {
    const s = atWar(0, 20);
    const ai = s.empires[1]!;
    const at = target(s).systemId;
    const bombers = newFleet(s, pack, ai, ["siege"], at);
    const transports = newFleet(s, pack, ai, ["troop_transport"], at); // 10 troops vs 20 defenders: 25 needed
    transports.invadeColonyId = target(s).id;
    bombers.supply = 20; // well supplied: no need to head home
    s.fleets.push(bombers, transports);
    expect(ordersFor(planAiTurn(s, pack, 1), bombers.id)).toContainEqual(expect.objectContaining({ type: "bombard", colonyId: target(s).id }));

    // Two more transports arrive: 30 troops are enough, so the bombing stops.
    bombers.bombardColonyId = target(s).id;
    transports.ships.push(...newFleet(s, pack, ai, ["troop_transport", "troop_transport"], at).ships);
    expect(ordersFor(planAiTurn(s, pack, 1), bombers.id)).toContainEqual(expect.objectContaining({ type: "bombard", colonyId: null }));
  });

  it("without bombers, goes all-out when the troops in orbit are close to even", () => {
    const s = atWar(0, 9);
    const at = target(s).systemId;
    const transports = newFleet(s, pack, s.empires[1]!, ["troop_transport"], at); // 10 troops vs 9: under the 12 a safe landing needs
    transports.invadeColonyId = target(s).id;
    s.fleets.push(transports);
    expect(ordersFor(planAiTurn(s, pack, 1), transports.id)).toContainEqual(expect.objectContaining({ type: "invade", colonyId: target(s).id, allOut: true }));
    // Well short (10 vs 20): they keep waiting for reinforcements.
    s.empires[1]!.colonySightings[0]!.troops = 20;
    expect(ordersFor(planAiTurn(s, pack, 1), transports.id).some((c) => c.type === "invade")).toBe(false);
  });

  it("sends commandos ahead to knock out a target's defenses", () => {
    const s = atWar(40, 10);
    const ai = s.empires[1]!;
    expect(decideStrategy(buildContext(s, pack, 1))).toMatchObject({ posture: "attack", targetColony: expect.objectContaining({ colonyId: target(s).id }) });
    const raiders = newFleet(s, pack, ai, ["infiltrator"], ai.homeSystemId);
    s.fleets.push(raiders);
    const orders = ordersFor(planAiTurn(s, pack, 1), raiders.id);
    expect(orders).toContainEqual(expect.objectContaining({ type: "moveFleet", destinationId: target(s).systemId }));
    expect(orders).toContainEqual(expect.objectContaining({ type: "sabotage", colonyId: target(s).id, mission: "defenses" }));
  });

  it("builds siege ships and commandos for the war, and troop ships in batches", () => {
    const s = atWar(40, 30);
    for (const c of s.colonies.filter((c) => c.empireId === 1)) c.queue = [];
    moreColonies(s, 3);
    s.empires[1]!.credits = 500;
    const queued = planAiTurn(s, pack, 1).flatMap((c) => (c.type === "queueBuild" ? [c.item] : []));
    expect(queued).toContainEqual(expect.objectContaining({ id: "siege" }));
    expect(queued).toContainEqual(expect.objectContaining({ id: "infiltrator" }));
    expect(queued).toContainEqual(expect.objectContaining({ id: "troop_transport", count: expect.any(Number) }));
  });

  it("designs a siege ship once bomb bays are researched", () => {
    const s = atWar(40, 10);
    const ai = s.empires[1]!;
    ai.designs = ai.designs.filter((d) => d.id !== "siege");
    const create = planAiTurn(s, pack, 1).find((c) => c.type === "createDesign" && c.design.name.startsWith("Siege"));
    expect(create).toMatchObject({ type: "createDesign", design: { name: "Siege Mk 1", hull: "cruiser" } });
    if (create?.type === "createDesign") expect(create.design.components.filter((c) => c === "bomb_bay")).toHaveLength(2);
  });

  it("counts support ships riding inside strike fleets, so it doesn't keep building more", () => {
    const s = atWar(40, 10);
    const ai = s.empires[1]!;
    ai.techs.push("extended_tanks");
    for (const c of s.colonies.filter((c) => c.empireId === 1)) c.queue = [];
    const strike = s.fleets.find((f) => f.empireId === 1 && f.ships.length === 8)!;
    const supply = newFleet(s, pack, ai, ["supply_ship"], strike.systemId);
    strike.ships.push(...supply.ships); // merged: the fleet is armed, but the supply ship is still there
    moreColonies(s, 6);
    ai.credits = 500;
    const queued = planAiTurn(s, pack, 1).flatMap((c) => (c.type === "queueBuild" ? [c.item.id] : []));
    expect(queued).not.toContain("supply_ship");
  });

  it("turns a combat outpost near the target into a supply depot", () => {
    const s = atWar(40, 10);
    const ai = s.empires[1]!;
    ai.techs.push("forward_depots");
    ai.credits = 1000;
    s.outposts.push({ id: 7700, empireId: 1, systemId: target(s).systemId, bodyId: 7701, kind: "combat", depot: false, defenseHp: 60 });
    expect(planAiTurn(s, pack, 1)).toContainEqual({ type: "upgradeOutpost", empireId: 1, outpostId: 7700 });
  });
});

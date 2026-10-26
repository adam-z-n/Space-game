import { describe, expect, it } from "vitest";
import { buildContext, createInitialState, decideStrategy, fleetStrength, knownAdjacency, newCommand, newColony, newFleet, planAiTurn, shortestPaths, type Command, type GameState } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";
import { chartAll, enlist } from "./helpers";

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
    s.fleets.push(enlist(s, bombers), enlist(s, transports));
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
    s.fleets.push(enlist(s, transports));
    expect(ordersFor(planAiTurn(s, pack, 1), transports.id)).toContainEqual(expect.objectContaining({ type: "invade", colonyId: target(s).id, allOut: true }));
    // Well short (10 vs 20): they keep waiting for reinforcements.
    s.empires[1]!.colonySightings[0]!.troops = 20;
    expect(ordersFor(planAiTurn(s, pack, 1), transports.id).some((c) => c.type === "invade")).toBe(false);
  });

  it("sends cloaked infiltrators ahead on their own, and other commandos with a strike fleet", () => {
    const s = atWar(40, 10);
    const ai = s.empires[1]!;
    expect(decideStrategy(buildContext(s, pack, 1))).toMatchObject({ posture: "attack", targetColony: expect.objectContaining({ colonyId: target(s).id }) });
    // Infiltrators (cloaked escorts with commandos) need no naval command.
    const raiders = newFleet(s, pack, ai, ["infiltrator"], ai.homeSystemId);
    s.fleets.push(raiders);
    const orders = ordersFor(planAiTurn(s, pack, 1), raiders.id);
    expect(orders).toContainEqual(expect.objectContaining({ type: "moveFleet", destinationId: target(s).systemId }));
    expect(orders).toContainEqual(expect.objectContaining({ type: "sabotage", colonyId: target(s).id, mission: "defenses" }));
    // Riding in a fleet bound for the target, other commandos strike its defenses too.
    s.fleets = s.fleets.filter((f) => f.id !== raiders.id);
    const strike = newFleet(s, pack, ai, ["frigate", "infiltrator"], ai.homeSystemId);
    strike.route = [target(s).systemId];
    s.fleets.push(enlist(s, strike));
    expect(ordersFor(planAiTurn(s, pack, 1), strike.id)).toContainEqual(expect.objectContaining({ type: "sabotage", colonyId: target(s).id, mission: "defenses" }));
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
    s.outposts.push({ id: 7700, empireId: 1, systemId: target(s).systemId, bodyId: 7701, kind: "combat", depot: false, mark: 0, defenseHp: 60 });
    expect(planAiTurn(s, pack, 1)).toContainEqual({ type: "upgradeOutpost", empireId: 1, outpostId: 7700 });
  });
});

describe("AI naval commands", () => {
  /** atWar, with only the 8-destroyer group for empire 1's warships (no starting fleet). */
  function strikeReady(): { s: GameState; groupId: number } {
    const s = atWar(0, 0);
    const ai = s.empires[1]!;
    s.fleets = s.fleets.filter((f) => f.empireId !== 1 || f.ships.length === 8);
    // The rival's capital moved next door, within the destroyers' supply.
    const lane = s.galaxy.lanes.find((l) => l.a === ai.homeSystemId || l.b === ai.homeSystemId)!;
    const near = lane.a === ai.homeSystemId ? lane.b : lane.a;
    const rival = target(s);
    s.galaxy.systems[near]!.bodies.push({ id: rival.bodyId, kind: "planet", planetType: "terran", size: "medium", richness: "normal" });
    rival.systemId = near;
    ai.colonySightings[0]!.systemId = near;
    return { s, groupId: s.fleets.find((f) => f.empireId === 1)!.id };
  }

  it("forms a strike fleet at its command's home within the points, and launches only once drilled", () => {
    const { s, groupId } = strikeReady();
    // Two more destroyers: 20 points, 16 in a warlord's command (12 + 4): the extras split off, the rest form a fleet and wait.
    const strike = s.fleets.find((f) => f.id === groupId)!;
    for (let i = 0; i < 2; i++) strike.ships.push({ ...structuredClone(strike.ships[0]!), id: s.nextId++ });
    const orders = ordersFor(planAiTurn(s, pack, 1), groupId);
    expect(orders).toContainEqual(expect.objectContaining({ type: "splitFleet" }));
    expect(orders).toContainEqual(expect.objectContaining({ type: "formFleet" }));
    expect(orders).not.toContainEqual(expect.objectContaining({ type: "moveFleet", destinationId: target(s).systemId }));

    // Formed and drilled (cohesion 80%+): it goes.
    const group = s.fleets.find((f) => f.id === groupId)!;
    group.ships = group.ships.slice(0, 6);
    enlist(s, group).command!.cohesion = 80;
    expect(ordersFor(planAiTurn(s, pack, 1), groupId)).toContainEqual(expect.objectContaining({ type: "moveFleet", destinationId: target(s).systemId }));
    group.command!.cohesion = 60;
    expect(ordersFor(planAiTurn(s, pack, 1), groupId)).not.toContainEqual(expect.objectContaining({ type: "moveFleet", destinationId: target(s).systemId }));
  });

  /** Guard the target so that `share` percent of `strength` is just what a strike needs (with the warlord's nerve). */
  function guardFor(s: GameState, strength: number, share: number): void {
    const nerve = 100 + pack.aiPersonalities.find((p) => p.id === "warlord")!.caution * 10;
    const hp = Math.floor((((strength * share) / 100) * 100 * 5) / nerve / 6);
    target(s).defenseHp = hp;
    s.empires[1]!.colonySightings[0]!.defenseHp = hp;
  }

  it("a spare officer forms a second fleet when the first, drilled, isn't enough", () => {
    const { s, groupId } = strikeReady();
    const ai = s.empires[1]!;
    ai.techs.push("officer_academy");
    const group = s.fleets.find((f) => f.id === groupId)!;
    const first = newFleet(s, pack, ai, ["frigate", "frigate", "frigate", "frigate"], group.systemId);
    s.fleets.push(enlist(s, first));
    group.ships = group.ships.slice(0, 4);
    guardFor(s, fleetStrength(pack, s, first) * 2, 85);
    const orders = planAiTurn(s, pack, 1);
    expect(ordersFor(orders, groupId)).toContainEqual(expect.objectContaining({ type: "formFleet" }));
    expect(ordersFor(orders, groupId)).not.toContainEqual(expect.objectContaining({ type: "mergeFleets" }));
    expect(ordersFor(orders, first.id).some((c) => c.type === "moveFleet")).toBe(false); // not enough alone: it waits
  });

  it("fleets from two commands strike together, timed to arrive on the same turn", () => {
    const { s, groupId } = strikeReady();
    const ai = s.empires[1]!;
    const home = s.fleets.find((f) => f.id === groupId)!;
    const near = enlist(s, home);
    near.ships = near.ships.slice(0, 4);
    // A second command based at a colony farther from the target, with a drilled fleet of its own.
    const adj = knownAdjacency(s, 1);
    const toTarget = shortestPaths(adj, target(s).systemId).dist;
    const speed = near.speed;
    const eta = (id: number) => Math.ceil(toTarget[id]! / speed);
    const far = s.galaxy.systems.map((x) => x.id).filter((id) => toTarget[id]! !== Infinity && eta(id) >= eta(near.systemId) + 2 && eta(id) <= eta(near.systemId) + 4)[0]!;
    const body = { id: 9500, kind: "planet" as const, planetType: "terran", size: "medium", richness: "normal" };
    s.galaxy.systems[far]!.bodies.push(body);
    s.colonies.push(newColony(s, ai, far, body.id, 8, false));
    const second = newCommand(s, ai, far, 0);
    const away = newFleet(s, pack, ai, ["frigate", "frigate", "frigate", "frigate"], far);
    away.command = { commandId: second.id, officer: { id: 99_001, name: "Far", xp: 0 }, flagshipId: away.ships[0]!.id, cohesion: 100 };
    s.fleets.push(away);
    ai.explored = s.galaxy.systems.map((x) => x.id);
    guardFor(s, fleetStrength(pack, s, near) + fleetStrength(pack, s, away), 90);
    // The far fleet leaves first; the near one waits until its trip matches.
    const orders = planAiTurn(s, pack, 1);
    expect(ordersFor(orders, away.id)).toContainEqual(expect.objectContaining({ type: "moveFleet", destinationId: target(s).systemId }));
    expect(ordersFor(orders, near.id).some((c) => c.type === "moveFleet")).toBe(false);
    // Once the far fleet is close enough, the near one goes too.
    away.route = [target(s).systemId];
    away.systemId = near.systemId;
    expect(ordersFor(planAiTurn(s, pack, 1), near.id)).toContainEqual(expect.objectContaining({ type: "moveFleet", destinationId: target(s).systemId }));
  });

  it("bases a new command at a colony when it can support one", () => {
    const s = atWar(0, 0);
    moreColonies(s, 5);
    // One of the new colonies sits in a neighbouring system.
    const capital = s.colonies.find((c) => c.empireId === 1 && c.capital)!;
    const next = s.galaxy.lanes.find((l) => l.a === capital.systemId || l.b === capital.systemId)!;
    const elsewhere = next.a === capital.systemId ? next.b : next.a;
    const moved = s.colonies.find((c) => c.id === 9101)!;
    moved.systemId = elsewhere;
    s.galaxy.systems[elsewhere]!.bodies.push({ id: moved.bodyId, kind: "planet", planetType: "terran", size: "medium", richness: "normal" });
    expect(planAiTurn(s, pack, 1)).toContainEqual({ type: "placeCommand", empireId: 1, commandId: null, systemId: elsewhere });
  });

  it("buys outpost marks with credits to spare when the way home is clear", () => {
    const s = atWar(0, 0);
    const ai = s.empires[1]!;
    const home = ai.homeSystemId;
    const bodyId = 9500;
    s.galaxy.systems[home]!.bodies.push({ id: bodyId, kind: "asteroids" });
    s.outposts.push({ id: 7700, empireId: 1, systemId: home, bodyId, kind: "combat", depot: false, mark: 0, defenseHp: 60 });
    ai.techs.push("heavy_lasers", "guided_torpedoes", "gauss_cannons");
    ai.credits = 1000;
    expect(planAiTurn(s, pack, 1)).toContainEqual({ type: "upgradeOutpostMark", empireId: 1, outpostId: 7700 });
    ai.credits = 200; // not enough to spare
    expect(planAiTurn(s, pack, 1)).not.toContainEqual(expect.objectContaining({ type: "upgradeOutpostMark" }));
  });

  it("aims at flagships with fleets that outgun what it has seen, and designs Guard ships to shield its own", () => {
    const { s, groupId } = strikeReady();
    const ai = s.empires[1]!;
    ai.techs.push("electronic_warfare", "command_ship_analysis");
    enlist(s, s.fleets.find((f) => f.id === groupId)!);
    const commands = planAiTurn(s, pack, 1);
    expect(ordersFor(commands, groupId)).toContainEqual(expect.objectContaining({ type: "setFleetOrders", orders: expect.objectContaining({ targetPriority: "flagship" }) }));
    expect(commands).toContainEqual(expect.objectContaining({ type: "createDesign", design: expect.objectContaining({ formation: "screen" }) }));
  });
});

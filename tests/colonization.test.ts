import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildOptions,
  colonizeBlocker,
  createInitialState,
  empireView,
  type Command,
  type GameState,
} from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();

function fresh(): GameState {
  return createInitialState({ seed: "colonize", galaxySize: "small", aiCount: 2 }, pack);
}

function run(state: GameState, ...commands: Command[]): GameState {
  for (const command of commands) {
    const result = applyCommand(state, command, pack);
    if (!result.ok) throw new Error(`${command.type}: ${result.error}`);
    state = result.state;
  }
  return state;
}

const planet = (planetType: string, id: number) => ({ id, kind: "planet" as const, planetType, size: "medium", richness: "normal" });

describe("habitability research", () => {
  it("opens barren worlds with Controlled Environments and toxic/volcanic worlds with Terraforming", () => {
    const s = fresh();
    const empire = s.empires[0]!;
    empire.species = "saurak"; // no habitability trait
    const can = (type: string) => colonizeBlocker(pack, empire, planet(type, 1)) === null;
    expect([can("arid"), can("tundra"), can("barren"), can("toxic"), can("volcanic")]).toEqual([true, true, false, false, false]);
    empire.techs = ["hydroponics", "controlled_environments"];
    expect([can("barren"), can("toxic"), can("volcanic")]).toEqual([true, false, false]);
    empire.techs.push("subterranean_habitats", "terraforming");
    expect([can("barren"), can("toxic"), can("volcanic")]).toEqual([true, true, true]);
  });

  it("every planet type is colonizable once all techs are researched", () => {
    const s = fresh();
    const empire = s.empires[0]!;
    empire.species = "saurak";
    empire.techs = pack.techs.map((t) => t.id);
    for (const type of pack.planetTypes) expect(colonizeBlocker(pack, empire, planet(type.id, 1)), type.id).toBeNull();
  });
});

describe("colony bases", () => {
  function withSister(): { s: GameState; capitalId: number; bodyId: number } {
    const s = fresh();
    const capital = s.colonies.find((c) => c.empireId === 0 && c.capital)!;
    const system = s.galaxy.systems[capital.systemId]!;
    system.bodies = system.bodies.filter((b) => b.id === capital.bodyId);
    system.bodies.push(planet("ocean", 9001), planet("toxic", 9002));
    return { s, capitalId: capital.id, bodyId: 9001 };
  }

  it("offers habitable planets in the colony's own system", () => {
    const { s, capitalId } = withSister();
    const capital = s.colonies.find((c) => c.id === capitalId)!;
    const bases = buildOptions(s, pack, s.empires[0]!, capital).filter((o) => o.kind === "colonyBase");
    expect(bases.map((b) => b.bodyId)).toEqual([9001]); // the toxic world needs research
  });

  it("founds a colony when the build completes, and refuses a second base for the same planet", () => {
    let { s, capitalId, bodyId } = withSister();
    const item = { kind: "colonyBase" as const, id: "colony_base", bodyId };
    s = run(s, { type: "queueBuild", empireId: 0, colonyId: capitalId, item });
    expect(applyCommand(s, { type: "queueBuild", empireId: 0, colonyId: capitalId, item }, pack)).toMatchObject({ ok: false, error: "already queued" });
    s.empires[0]!.credits = 1000;
    s = run(s, { type: "buyBuild", empireId: 0, colonyId: capitalId }, { type: "endTurn" });
    const founded = s.colonies.find((c) => c.bodyId === bodyId)!;
    expect(founded.empireId).toBe(0);
    expect(founded.population).toBe(pack.economy.colonyPopulation);
    expect(s.lastTurnEvents.some((e) => e.type === "colonyFounded" && e.colonyId === founded.id)).toBe(true);
  });
});

describe("star charts", () => {
  it("shows only charted systems and the lanes between them", () => {
    const s = fresh();
    const view = empireView(s, pack, 0);
    const charted = new Set(s.empires[0]!.charted);
    expect(charted.size).toBeGreaterThan(1);
    expect(charted.size).toBeLessThan(s.galaxy.systems.length);
    for (const sys of view.systems) expect(sys.charted).toBe(charted.has(sys.id));
    expect(view.systems.filter((x) => !x.charted).every((x) => x.name === "" && x.bodies === null)).toBe(true);
    expect(view.lanes.every((l) => charted.has(l.a) && charted.has(l.b))).toBe(true);
  });

  it("charts the neighbors of the home system and refuses routes to uncharted systems", () => {
    const s = fresh();
    const empire = s.empires[0]!;
    for (const lane of s.galaxy.lanes) {
      if (lane.a === empire.homeSystemId) expect(empire.charted).toContain(lane.b);
      if (lane.b === empire.homeSystemId) expect(empire.charted).toContain(lane.a);
    }
    const fleet = s.fleets.find((f) => f.empireId === 0)!;
    const unknown = s.galaxy.systems.find((x) => !empire.charted.includes(x.id))!;
    expect(applyCommand(s, { type: "moveFleet", empireId: 0, fleetId: fleet.id, destinationId: unknown.id }, pack)).toMatchObject({ ok: false });
  });

  it("classifies explored systems by what can be settled", () => {
    const s = fresh();
    const home = s.empires[0]!.homeSystemId;
    expect(empireView(s, pack, 0).systems[home]!.survey).toBe("habitable");
    s.galaxy.systems[home]!.bodies = [planet("toxic", 1)];
    s.colonies = s.colonies.filter((c) => c.systemId !== home);
    s.empires[0]!.species = "saurak";
    expect(empireView(s, pack, 0).systems[home]!.survey).toBe("hostile");
    s.galaxy.systems[home]!.bodies = [{ id: 1, kind: "gasGiant" }];
    expect(empireView(s, pack, 0).systems[home]!.survey).toBe("barren");
  });
});

describe("queueing new buildings everywhere", () => {
  it("lists what a tech unlocks and the colonies still missing that building", async () => {
    const { coloniesMissing, techUnlocks } = await import("../src/core");
    expect(techUnlocks(pack, "hydroponics").buildings).toEqual(["hydroponic_farm"]);
    expect(techUnlocks(pack, "cruiser_hulls").hulls).toEqual(["cruiser"]);
    let s = fresh();
    const capital = s.colonies.find((c) => c.empireId === 0 && c.capital)!;
    expect(coloniesMissing(s, pack, 0, "hydroponic_farm")).toEqual([]); // not researched yet
    s.empires[0]!.techs.push("hydroponics");
    expect(coloniesMissing(s, pack, 0, "hydroponic_farm").map((c) => c.id)).toEqual([capital.id]);
    s = run(s, { type: "queueBuild", empireId: 0, colonyId: capital.id, item: { kind: "building", id: "hydroponic_farm" } });
    expect(coloniesMissing(s, pack, 0, "hydroponic_farm")).toEqual([]);
  });
});

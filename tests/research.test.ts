import { describe, expect, it } from "vitest";
import {
  Rng,
  applyCommand,
  availableTechs,
  captureTech,
  createInitialState,
  designBlocker,
  getTech,
  hullSlots,
  schoolBlocker,
  schoolsAllowed,
  techAvailable,
  techCost,
  updateSightings,
  type GameEvent,
  type GameState,
} from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();

function fresh(species = "saurak"): GameState {
  const s = createInitialState({ seed: "research", galaxySize: "small", aiCount: 2 }, pack);
  s.empires[0]!.species = species;
  return s;
}

/** Everything needed to research `id`, in order. */
function withPrereqs(id: string, into: string[] = []): string[] {
  for (const req of getTech(pack, id).requires) withPrereqs(req, into);
  if (!into.includes(id)) into.push(id);
  return into;
}

function learn(s: GameState, id: string): void {
  const empire = s.empires[0]!;
  for (const t of withPrereqs(id)) {
    if (empire.techs.includes(t)) continue;
    empire.techs.push(t);
    const school = getTech(pack, t).school;
    if (school && !empire.schools.includes(school)) empire.schools.push(school);
  }
}

describe("research tree", () => {
  it("has core techs and three schools of three in every field", () => {
    const core = pack.techs.filter((t) => !t.school);
    expect(pack.techs.length).toBeGreaterThanOrEqual(110);
    expect(core.length).toBeGreaterThanOrEqual(40);
    for (const field of pack.researchFields) {
      const schools = pack.researchSchools.filter((s) => s.field === field.id);
      expect(schools, field.id).toHaveLength(3);
      for (const school of schools) expect(pack.techs.filter((t) => t.school === school.id), school.id).toHaveLength(3);
    }
  });

  it("lets every race reach at least 60% of the tree, and the generalists all of it", () => {
    const total = pack.techs.length;
    const core = pack.techs.filter((t) => !t.school).length;
    for (const species of pack.species) {
      if (species.research.access === "full") continue;
      const doubled = 1 + species.research.twoSchools.length; // two schools in the affinity field and each twoSchools field
      const reachable = core + pack.researchFields.length * 3 + doubled * 3;
      expect(reachable / total, species.id).toBeGreaterThanOrEqual(0.6);
    }
    expect(pack.species.filter((s) => s.research.access === "full").map((s) => s.id).sort()).toEqual(["mekkan", "psyrrh", "terran"]);
  });
});

describe("schools", () => {
  it("researching a school closes its rivals for limited races", () => {
    const s = fresh("saurak");
    learn(s, "plasma_lances"); // Beam Weapons
    const empire = s.empires[0]!;
    expect(empire.schools).toContain("beams");
    learn(s, "guided_torpedoes");
    expect(techAvailable(pack, empire, "hellfire_missiles")).toBe(false); // Missiles is closed
    expect(techAvailable(pack, empire, "particle_beams")).toBe(true);
  });

  it("allows two schools in the affinity field", () => {
    const s = fresh("saurak"); // affinity: Logistics & Trade
    const empire = s.empires[0]!;
    expect(schoolsAllowed(pack, empire, "logistics")).toBe(2);
    expect(schoolsAllowed(pack, empire, "growth")).toBe(1);
    const [a, b, c] = pack.researchSchools.filter((x) => x.field === "logistics").map((x) => pack.techs.filter((t) => t.school === x.id));
    learn(s, a![0]!.id);
    learn(s, b![0]!.id);
    expect(c!.every((t) => schoolBlocker(pack, empire, t) !== null)).toBe(true);
  });

  it("allows two schools in a race's twoSchools fields", () => {
    const s = fresh("felari"); // two schools in Propulsion as well as Weapons
    const empire = s.empires[0]!;
    expect(schoolsAllowed(pack, empire, "propulsion")).toBe(2);
    expect(schoolsAllowed(pack, empire, "defense")).toBe(1);
    const [a, b, c] = pack.researchSchools.filter((x) => x.field === "propulsion").map((x) => pack.techs.filter((t) => t.school === x.id));
    learn(s, a![0]!.id);
    learn(s, b![0]!.id);
    expect(empire.schools.filter((x) => pack.researchSchools.find((y) => y.id === x)?.field === "propulsion")).toHaveLength(2);
    expect(c!.every((t) => schoolBlocker(pack, empire, t) !== null)).toBe(true);
  });

  it("leaves every school open to full-access races", () => {
    const s = fresh("terran");
    const empire = s.empires[0]!;
    learn(s, "plasma_lances");
    learn(s, "guided_torpedoes");
    expect(techAvailable(pack, empire, "hellfire_missiles")).toBe(true);
  });

  it("commits to a school when its first tech is researched", () => {
    let s = fresh("felari");
    const empire = s.empires[0]!;
    learn(s, "heavy_lasers");
    empire.research = { current: "gauss_cannons", progress: 10_000 };
    const result = applyCommand(s, { type: "endTurn" }, pack);
    if (!result.ok) throw new Error(result.error);
    s = result.state;
    expect(s.empires[0]!.schools).toContain("kinetics");
  });

  it("makes affinity techs cheaper", () => {
    const felari = fresh("felari").empires[0]!;
    const terran = fresh("terran").empires[0]!;
    const lance = getTech(pack, "plasma_lances");
    expect(techCost(pack, terran, lance)).toBe(lance.cost);
    const bonus = pack.species.find((s) => s.id === "felari")!.research.affinityPercent;
    expect(bonus).toBeGreaterThan(0);
    expect(techCost(pack, felari, lance)).toBe(Math.ceil((lance.cost * 100) / (100 + bonus)));
  });
});

describe("conquest", () => {
  it("can capture the cheapest tech the defender knows, even from a closed school, without committing to it", () => {
    const s = fresh("saurak");
    learn(s, "plasma_lances"); // attacker follows Beams
    const defender = s.empires[1]!;
    defender.techs = withPrereqs("hellfire_missiles");
    const colony = s.colonies.find((c) => c.empireId === 1)!;
    let captured: GameEvent | undefined;
    for (let seed = 0; seed < 50 && !captured; seed++) {
      const events: GameEvent[] = [];
      captureTech(s, pack, Rng.fromSeed(`capture-${seed}`), 0, 1, colony, events);
      captured = events.find((e) => e.type === "techCaptured");
    }
    expect(captured).toMatchObject({ type: "techCaptured", empireId: 0, techId: "hellfire_missiles" });
    expect(s.empires[0]!.techs).toContain("hellfire_missiles");
    expect(s.empires[0]!.schools).not.toContain("missiles");
  });
});

describe("special techs", () => {
  it("Miniaturization adds a slot to every hull", () => {
    const s = fresh("terran");
    const empire = s.empires[0]!;
    expect(hullSlots(pack, empire, "frigate")).toBe(3);
    const design = { name: "Packed", hull: "frigate", components: ["laser", "laser", "laser", "laser"], formation: "front" as const };
    expect(designBlocker(pack, empire, design)).toBe("only 3 slots");
    learn(s, "miniaturization");
    expect(hullSlots(pack, empire, "frigate")).toBe(4);
    expect(designBlocker(pack, empire, design)).toBeNull();
  });

  it("Galactic Survey charts the whole galaxy", () => {
    const s = fresh("terran");
    expect(s.empires[0]!.charted.length).toBeLessThan(s.galaxy.systems.length);
    learn(s, "galactic_survey");
    updateSightings(s, pack, null, s.turn);
    expect(s.empires[0]!.charted).toHaveLength(s.galaxy.systems.length);
  });

  it("closed techs never appear as available research", () => {
    const s = fresh("kraal");
    learn(s, "deep_core_mining");
    learn(s, "cruiser_hulls");
    expect(availableTechs(pack, s.empires[0]!).map((t) => t.id)).toContain("reinforced_frames"); // affinity: second school
    learn(s, "reinforced_frames");
    expect(availableTechs(pack, s.empires[0]!).map((t) => t.id)).not.toContain("fighter_squadrons");
  });
});

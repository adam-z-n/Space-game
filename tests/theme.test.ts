import { describe, expect, it } from "vitest";
import raw from "../content/default/pack.json";
import { colonyOutput, createInitialState, flagshipHull, loadContentPack, validateSettings, type GameState } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();
const clone = () => JSON.parse(JSON.stringify(raw));
const fresh = (playerEmpire?: number): GameState =>
  createInitialState({ seed: "theme", galaxySize: "small", aiCount: 2, ...(playerEmpire === undefined ? {} : { playerEmpire }) }, pack);

describe("species", () => {
  it("applies species traits to colony output", () => {
    const s = fresh();
    const capital = s.colonies.find((c) => c.empireId === 0 && c.capital)!;
    s.empires[0]!.species = "saurak"; // growth only: base numbers
    const base = colonyOutput(s, pack, capital);
    s.empires[0]!.species = "kraal"; // +30% industry
    expect(colonyOutput(s, pack, capital).industry).toBe(Math.floor((base.industry * 130) / 100));
    s.empires[0]!.species = "psyrrh"; // +40% research
    expect(colonyOutput(s, pack, capital).research).toBe(Math.floor((base.research * 140) / 100));
  });

  it("gives every empire its template's species", () => {
    const s = fresh();
    for (const empire of s.empires) {
      expect(pack.empires.find((t) => t.name === empire.name)!.species).toBe(empire.species);
    }
  });
});

describe("player empire choice", () => {
  it("defaults to the pack's first empire", () => {
    expect(fresh().empires[0]!.name).toBe(pack.empires[0]!.name);
  });

  it("gives the player the chosen empire and keeps it away from the AIs", () => {
    const s = fresh(3);
    expect(s.empires[0]!.name).toBe(pack.empires[3]!.name);
    expect(s.empires[0]!.species).toBe(pack.empires[3]!.species);
    expect(s.empires.slice(1).map((e) => e.name)).not.toContain(pack.empires[3]!.name);
  });

  it("rejects an unknown empire", () => {
    const base = { seed: "x", galaxySize: "small" as const, aiCount: 2 };
    expect(validateSettings({ ...base, playerEmpire: pack.empires.length }, pack)).toBe("unknown player empire");
    expect(validateSettings({ ...base, playerEmpire: -1 }, pack)).toBe("unknown player empire");
    expect(validateSettings({ ...base, playerEmpire: 1.5 }, pack)).toBe("unknown player empire");
  });
});

describe("flagship hull", () => {
  it("shows the largest hull in a fleet", () => {
    const s = fresh();
    const empire = s.empires[0]!;
    const fleet = s.fleets.find((f) => f.empireId === 0 && f.ships.length > 1) ?? s.fleets.find((f) => f.empireId === 0)!;
    const hulls = fleet.ships.map((ship) => empire.designs.find((d) => d.id === ship.designId)!.hull);
    const expected = [...hulls].sort((a, b) => {
      const ha = pack.hulls.find((h) => h.id === a)!;
      const hb = pack.hulls.find((h) => h.id === b)!;
      return hb.slots - ha.slots || hb.structure - ha.structure;
    })[0];
    expect(flagshipHull(pack, s, fleet)).toBe(expected);
    const battleship = { id: "bb", name: "BB", hull: "battleship", components: [], formation: "front" as const, obsolete: false };
    empire.designs.push(battleship);
    fleet.ships.push({ id: 9999, designId: "bb", hp: 1 });
    expect(flagshipHull(pack, s, fleet)).toBe("battleship");
  });
});

describe("presentation", () => {
  it("requires a sprite for every hull", () => {
    const p = clone();
    delete p.presentation.hullSprites.cruiser;
    expect(() => loadContentPack(p)).toThrow(/cruiser/);
  });

  it("rejects ragged sprite rows and undefined palette characters", () => {
    const p = clone();
    p.presentation.hullSprites.corvette.rows[0] += "@";
    p.presentation.hullSprites.frigate.rows[0] = p.presentation.hullSprites.frigate.rows[0].replace(/./, "Z");
    expect(() => loadContentPack(p)).toThrow(/width[\s\S]*Z|Z[\s\S]*width/);
  });

  it("rejects an empire with an unknown species", () => {
    const p = clone();
    p.empires[0].species = "gremlin";
    expect(() => loadContentPack(p)).toThrow(/gremlin/);
  });
});

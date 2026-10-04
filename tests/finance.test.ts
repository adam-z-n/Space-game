import { describe, expect, it } from "vitest";
import { applyCommand, colonyOutput, createInitialState, empireEconomy, fitWorkers, scrapValue, type Command, type GameState } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();

function fresh(): GameState {
  const s = createInitialState({ seed: "finance", galaxySize: "small", aiCount: 2 }, pack);
  s.empires[0]!.species = "saurak"; // growth trait only, so credits and output are the base numbers
  return s;
}

function run(state: GameState, ...commands: Command[]): GameState {
  for (const command of commands) {
    const result = applyCommand(state, command, pack);
    if (!result.ok) throw new Error(`${command.type}: ${result.error}`);
    state = result.state;
  }
  return state;
}

const capital = (s: GameState) => s.colonies.find((c) => c.empireId === 0 && c.capital)!;

describe("taxes", () => {
  it("trade growth and output for income", () => {
    const s = fresh();
    const normal = colonyOutput(s, pack, capital(s));
    const high = colonyOutput(run(s, { type: "setTaxLevel", empireId: 0, taxLevel: "high" }), pack, capital(s));
    const low = colonyOutput(run(s, { type: "setTaxLevel", empireId: 0, taxLevel: "low" }), pack, capital(s));
    // 5 pop: tax is 25/50/75% per pop, plus the capitol's 3.
    expect([low.credits, normal.credits, high.credits]).toEqual([1 + 3, 2 + 3, 3 + 3]);
    expect(high.industry).toBeLessThan(normal.industry);
    expect(high.growth).toBeLessThan(normal.growth);
    expect(low.growth).toBeGreaterThan(normal.growth);
    expect(applyCommand(s, { type: "setTaxLevel", empireId: 0, taxLevel: "free" }, pack).ok).toBe(false);
  });
});

describe("food sales", () => {
  it("sells food above the reserve instead of wasting it", () => {
    let s = fresh();
    s.empires[0]!.food = 100;
    const full = empireEconomy(s, pack, 0);
    expect(full.foodSold).toBe(full.netFood); // the store is full: all surplus sells
    expect(full.foodSales).toBe(Math.floor((full.foodSold * pack.economy.foodSalePercent) / 100));
    s = run(s, { type: "setFoodReserve", empireId: 0, reserve: 60 });
    const eco = empireEconomy(s, pack, 0);
    expect(eco.foodSold).toBe(40 + eco.netFood);
    const credits = s.empires[0]!.credits;
    s = run(s, { type: "endTurn" });
    expect(s.empires[0]!.food).toBe(60);
    expect(s.empires[0]!.credits).toBe(credits + eco.netCredits);
  });
});

describe("hand-placed workers", () => {
  it("override the focus and must add up to the population", () => {
    let s = fresh();
    const id = capital(s).id;
    expect(applyCommand(s, { type: "setWorkers", empireId: 0, colonyId: id, workers: { farmers: 1, industry: 1, research: 1 } }, pack)).toMatchObject({ ok: false });
    s = run(s, { type: "setWorkers", empireId: 0, colonyId: id, workers: { farmers: 0, industry: 0, research: 5 } });
    expect(colonyOutput(s, pack, capital(s)).workers).toEqual({ farmers: 0, industry: 0, research: 5 });
    s = run(s, { type: "setWorkers", empireId: 0, colonyId: id, workers: null });
    expect(colonyOutput(s, pack, capital(s)).workers.farmers).toBeGreaterThan(0);
  });

  it("follow population changes: growth joins industry, losses come from research, then industry, then farms", () => {
    expect(fitWorkers({ farmers: 2, industry: 1, research: 2 }, 7)).toEqual({ farmers: 2, industry: 3, research: 2 });
    expect(fitWorkers({ farmers: 2, industry: 1, research: 2 }, 2)).toEqual({ farmers: 2, industry: 0, research: 0 });
  });
});

describe("scrapping", () => {
  it("refunds part of a building's cost and stops its upkeep", () => {
    let s = fresh();
    const id = capital(s).id;
    const before = s.empires[0]!.credits;
    const upkeep = empireEconomy(s, pack, 0).buildingUpkeep;
    const platform = pack.buildings.find((b) => b.id === "defense_platform")!;
    s = run(s, { type: "scrapBuilding", empireId: 0, colonyId: id, buildingId: "defense_platform" });
    expect(s.empires[0]!.credits).toBe(before + Math.floor((platform.cost * pack.economy.scrapRefundPercent) / 100));
    expect(empireEconomy(s, pack, 0).buildingUpkeep).toBe(upkeep - platform.upkeep);
    expect(capital(s).defenseHp).toBe(0);
    expect(applyCommand(s, { type: "scrapBuilding", empireId: 0, colonyId: id, buildingId: "capitol" }, pack).ok).toBe(false);
  });

  it("refunds part of a fleet's cost inside supply only", () => {
    let s = fresh();
    const fleet = s.fleets.find((f) => f.empireId === 0)!;
    const value = scrapValue(s, pack, fleet);
    expect(value).toBeGreaterThan(0);
    const before = s.empires[0]!.credits;
    s = run(s, { type: "disbandFleet", empireId: 0, fleetId: fleet.id });
    expect(s.empires[0]!.credits).toBe(before + value);
    const far = fresh();
    const lost = far.fleets.find((f) => f.empireId === 0)!;
    lost.systemId = far.empires[1]!.homeSystemId;
    expect(scrapValue(far, pack, lost)).toBe(0);
  });
});

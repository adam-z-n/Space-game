import { describe, expect, it } from "vitest";
import { buildContext, createInitialState, decideStrategy } from "../src/core";
import { improvesWarship, strategicTarget } from "../src/core/ai/strategy";
import type { ColonySighting, GameState } from "../src/core";
import { chartAll } from "./helpers";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();

describe("difficulty levels", () => {
  it("go Easy, Normal, Veteran, Hard; Veteran gives no bonuses, only better play", () => {
    expect(pack.difficulties.map((d) => d.id)).toEqual(["easy", "normal", "veteran", "hard"]);
    const veteran = pack.difficulties.find((d) => d.id === "veteran")!;
    expect(veteran.effects).toEqual({});
    expect(veteran.ai).toMatchObject({ aggression: 2, caution: -2, military: 1, launchCohesion: 70, strategic: true });
    // Hard plays the same way, with its bonuses on top; Normal is the default play.
    expect(pack.difficulties.find((d) => d.id === "hard")!.ai).toEqual(veteran.ai);
    expect(pack.difficulties.find((d) => d.id === "normal")!.ai).toMatchObject({ aggression: 0, launchCohesion: 80, strategic: false });
  });

  it("shift an AI's temperament within 0-10 and set how it plays; the human's empire plays Normal", () => {
    const s = createInitialState({ seed: "skill", galaxySize: "small", aiCount: 2, difficulty: "veteran" }, pack);
    const ai = s.empires[1]!;
    ai.personality = "warlord";
    const base = pack.aiPersonalities.find((p) => p.id === "warlord")!;
    const ctx = buildContext(s, pack, 1);
    expect(ctx.personality.aggression).toBe(Math.min(10, base.aggression + 2));
    expect(ctx.personality.caution).toBe(Math.max(0, base.caution - 2));
    expect(ctx.personality.military).toBe(Math.min(10, base.military + 1));
    expect(ctx.skill.launchCohesion).toBe(70);
    expect(buildContext(s, pack, 0).skill).toMatchObject({ launchCohesion: 80, strategic: false });
    expect(decideStrategy(ctx)).toBeDefined();
  });

  it("Veteran research leans to techs that improve its current warship", () => {
    const s = createInitialState({ seed: "skill", galaxySize: "small", aiCount: 2, difficulty: "veteran" }, pack);
    const ctx = buildContext(s, pack, 1);
    // A better armor than the starting plating does; a growth tech doesn't.
    const better = pack.components.filter((c) => c.kind === "armor" && c.requires).sort((a, b) => a.hp - b.hp).find((c) => c.hp > pack.components.find((x) => x.id === "armor_plating")!.hp)!;
    expect(improvesWarship(ctx, better.requires!)).toBe(true);
    expect(improvesWarship(ctx, "hydroponics")).toBe(false);
  });
});

describe("Veteran strategy", () => {
  /** Empire 1 (Veteran) and known rival colonies at systems sorted by distance from its home. */
  function setup() {
    const s = createInitialState({ seed: "veteran-targets", galaxySize: "small", aiCount: 3, difficulty: "veteran" }, pack);
    chartAll(s);
    const ai = s.empires[1]!;
    ai.explored = s.galaxy.systems.map((x) => x.id);
    const ctx = buildContext(s, pack, 1);
    const d = ctx.dist(ai.homeSystemId);
    const systems = s.galaxy.systems.map((x) => x.id).filter((id) => id !== ai.homeSystemId && d[id]! !== Infinity).sort((a, b) => d[a]! - d[b]! || a - b);
    const seen = (id: number, empireId: number, systemId: number, population: number, defenseHp: number): ColonySighting => ({
      colonyId: id, empireId, systemId, bodyId: id, name: `C${id}`, population, defenseHp, troops: 5, turn: s.turn,
    });
    return { s, ai, systems, seen };
  }
  const ctxOf = (s: GameState) => buildContext(s, pack, 1);

  it("goes for the colony worth most for what it costs, not just the nearest", () => {
    const { s, ai, systems, seen } = setup();
    const near = seen(801, 2, systems[0]!, 2, 300); // small, well defended, next door
    const rich = seen(802, 3, systems[3]!, 14, 0); // big, undefended, a little farther
    ai.colonySightings = [near, rich];
    expect(strategicTarget(ctxOf(s), ai.colonySightings)?.colonyId).toBe(802);
    // Rival warships seen near it make it cost more.
    ai.sightings = [{ fleetId: 990, empireId: 3, name: "Home Fleet", systemId: systems[3]!, nextSystemId: null, progress: 0, ships: 10, hull: "cruiser", strength: 2000, armed: true, turn: s.turn }];
    expect(strategicTarget(ctxOf(s), ai.colonySightings)?.colonyId).toBe(801);
  });

  it("turns on a rival running away with the game", () => {
    const { s, ai, systems, seen } = setup();
    // Empire 3 holds six known colonies far away; empire 2 one colony next door.
    ai.colonySightings = [seen(810, 2, systems[0]!, 6, 0), ...[1, 2, 3, 4, 5, 6].map((i) => seen(820 + i, 3, systems[systems.length - i]!, 6, 40))];
    expect(strategicTarget(ctxOf(s), ai.colonySightings)?.empireId).toBe(3);
    // Not a runaway with only two more than the next empire.
    ai.colonySightings = ai.colonySightings.slice(0, 4);
    expect(strategicTarget(ctxOf(s), ai.colonySightings)?.empireId).toBe(2);
  });
});

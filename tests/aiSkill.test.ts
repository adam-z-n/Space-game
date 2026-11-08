import { describe, expect, it } from "vitest";
import { buildContext, createInitialState, decideStrategy } from "../src/core";
import { improvesWarship } from "../src/core/ai/strategy";
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

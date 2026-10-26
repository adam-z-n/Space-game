import { describe, expect, it } from "vitest";
import { buildContext, createInitialState, type GameState } from "../src/core";
import { planWarship, weaponValue } from "../src/core/ai/designs";
import { defaultPack } from "../src/content/defaultPack";

const pack = defaultPack();
const part = (id: string) => pack.components.find((c) => c.id === id)!;

function empireWith(personality: string, techs: string[]): GameState {
  const s = createInitialState({ seed: "ai-designs", galaxySize: "small", aiCount: 2 }, pack);
  const ai = s.empires[1]!;
  ai.personality = personality;
  ai.techs.push(...techs);
  return s;
}

describe("AI warship designs", () => {
  it("values weapons by what they do against shields", () => {
    // Against no shields a plain gun of the same damage is as good as a pierce gun; against shields it falls behind.
    const gauss = part("gauss_cannon");
    const plain = { ...gauss, special: undefined };
    expect(weaponValue(gauss, 0, "line")).toBe(weaponValue(plain, 0, "line"));
    expect(weaponValue(gauss, 6, "line")).toBeGreaterThan(weaponValue(plain, 6, "line"));
    // Ion cannons are worth nothing against unshielded enemies.
    expect(weaponValue(part("ion_cannon"), 0, "line")).toBe(0);
    expect(weaponValue(part("ion_cannon"), 6, "line")).toBeGreaterThan(0);
    // Raiders like phase torpedoes better than others do.
    expect(weaponValue(part("phase_torpedo"), 2, "raider")).toBeGreaterThan(weaponValue(part("phase_torpedo"), 2, "line"));
  });

  it("warlords mix in ion cannons and a graviton lance; fortress designs carry an EMP torpedo", () => {
    const techs = ["cruiser_hulls", "capital_ships", "deflector_shields", "hardened_shields", "ion_cannons", "graviton_weapons", "emp_torpedoes", "point_defense"];
    const warlord = planWarship(buildContext(empireWith("warlord", techs), pack, 1)).create!;
    expect(warlord.hull).toBe("battleship");
    expect(warlord.components).toContain("ion_cannon");
    expect(warlord.components).toContain("graviton_lance");
    const turtle = planWarship(buildContext(empireWith("turtle", techs), pack, 1)).create!;
    expect(turtle.components).toContain("emp_torpedo");
    expect(turtle.components).not.toContain("graviton_lance");
  });
});

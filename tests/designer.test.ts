import { describe, expect, it } from "vitest";
import { defaultPack } from "../src/content/defaultPack";
import { partCategory } from "../src/web/shipPanels";

const pack = defaultPack();
const category = (id: string) => partCategory(pack.components.find((c) => c.id === id)!);

describe("ship designer parts list", () => {
  it("files every part under a category, weapons by type", () => {
    for (const c of pack.components) expect(partCategory(c)).toBeTruthy();
    expect(category("laser")).toBe("beams");
    expect(category("torpedo")).toBe("missiles");
    expect(category("emp_torpedo")).toBe("missiles");
    expect(category("mass_driver")).toBe("guns");
    expect(category("gauss_cannon")).toBe("guns");
    expect(category("graviton_lance")).toBe("special");
    expect(category("bomb_bay")).toBe("bombs");
    expect(category("armor_plating")).toBe("armor");
    expect(category("command_network")).toBe("electronics");
    expect(category("commando_team")).toBe("support");
  });
});

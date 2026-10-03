import { describe, expect, it } from "vitest";
import raw from "../content/default/pack.json";
import { ContentError, loadContentPack } from "../src/core";

const clone = () => JSON.parse(JSON.stringify(raw));

describe("content pack loading", () => {
  it("accepts the default pack", () => {
    expect(loadContentPack(raw).id).toBe("default");
  });

  it("rejects unknown references", () => {
    const pack = clone();
    pack.start.homeworldPlanetType = "lava";
    expect(() => loadContentPack(pack)).toThrow(/homeworldPlanetType: unknown id "lava"/);
  });

  it("rejects duplicate ids", () => {
    const pack = clone();
    pack.planetTypes.push({ ...pack.planetTypes[0] });
    expect(() => loadContentPack(pack)).toThrow(/duplicate id "terran"/);
  });

  it("rejects too few system names for the largest galaxy", () => {
    const pack = clone();
    pack.systemNames = pack.systemNames.slice(0, 30);
    expect(() => loadContentPack(pack)).toThrow(/system names/);
  });

  it("reports every problem at once", () => {
    const pack = clone();
    pack.starTypes[0].color = "yellow";
    pack.version = "one";
    try {
      loadContentPack(pack);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ContentError);
      expect((e as ContentError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

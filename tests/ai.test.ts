import { describe, expect, it } from "vitest";
import {
  Game,
  applyCommand,
  buildContext,
  checkVictory,
  createInitialState,
  turnLimit,
  validateSettings,
  decideStrategy,
  empireEffects,
  empireScore,
  newFleet,
  planAiTurn,
  type GameState,
} from "../src/core";
import { defaultPack } from "../src/content/defaultPack";
import { chartAll } from "./helpers";

const pack = defaultPack();

describe("AI setup", () => {
  it("deals personalities to AI empires and difficulty to AI empires only", () => {
    const s = createInitialState({ seed: "ai-setup", galaxySize: "small", aiCount: 4, difficulty: "hard" }, pack);
    expect(s.empires[0]).toMatchObject({ isAI: false, personality: null, difficulty: null });
    const ids = pack.aiPersonalities.map((p) => p.id);
    for (const e of s.empires.slice(1)) {
      expect(ids).toContain(e.personality);
      expect(e.difficulty).toBe("hard");
    }
    expect(new Set(s.empires.slice(1).map((e) => e.personality)).size).toBe(4); // dealt from a shuffled deck
    expect(empireEffects(pack, s.empires[1]!).industryPercent).toBe(40);
    expect(empireEffects(pack, s.empires[0]!).industryPercent).toBe(0);
  });

  it("rejects unknown difficulties", () => {
    expect(() => createInitialState({ seed: "x", galaxySize: "small", aiCount: 2, difficulty: "nightmare" }, pack)).toThrow(/difficulty/);
  });
});

describe("AI behaviour", () => {
  it("plays long games without invalid commands, expands, and stays solvent", () => {
    const game = Game.create({ seed: "ai-long", galaxySize: "small", aiCount: 3, allAI: true, turnLimit: 999 }, pack);
    const peak = new Map<number, number>();
    for (let i = 0; i < 120; i++) {
      game.endTurn();
      for (const e of game.state.empires) peak.set(e.id, Math.max(peak.get(e.id) ?? 0, game.state.colonies.filter((c) => c.empireId === e.id).length));
    }
    expect(game.aiRejections).toEqual([]);
    for (const empire of game.state.empires) {
      // With conquest an empire may lose colonies later, but every one should have expanded.
      expect(peak.get(empire.id)).toBeGreaterThan(1);
      expect(empire.credits).toBeGreaterThan(-100);
      if (!empire.eliminated) expect(empire.techs.length).toBeGreaterThan(8);
    }
  }, 30_000); // a full AI game

  it("is deterministic", () => {
    const settings = { seed: "ai-det", galaxySize: "small", aiCount: 3, allAI: true };
    const a = Game.create(settings, pack);
    const b = Game.create(settings, pack);
    for (let i = 0; i < 60; i++) {
      a.endTurn();
      b.endTurn();
    }
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  }, 30_000);

  it("never reacts to rival fleets it cannot see", () => {
    const game = Game.create({ seed: "ai-fog", galaxySize: "medium", aiCount: 3 }, pack);
    for (let i = 0; i < 15; i++) game.endTurn();
    const s = game.state;
    const viewer = 1;
    const seen = new Set(s.empires[viewer]!.sightings.filter((x) => x.turn === s.turn).map((x) => x.fleetId));
    const hidden = s.fleets.find((f) => f.empireId !== viewer && !seen.has(f.id));
    expect(hidden).toBeDefined();
    const before = JSON.stringify(planAiTurn(s, pack, viewer));
    // Teleport an unseen rival fleet somewhere and give it more ships: invisible, so nothing should change.
    const changed: GameState = JSON.parse(JSON.stringify(s));
    const fleet = changed.fleets.find((f) => f.id === hidden!.id)!;
    fleet.systemId = (fleet.systemId + 7) % changed.galaxy.systems.length;
    fleet.ships.push({ ...fleet.ships[0]!, id: 999999 });
    expect(JSON.stringify(planAiTurn(changed, pack, viewer))).toBe(before);
  });

  it("goes on the defensive when enemy warships are seen inside its supply zone", () => {
    const s = createInitialState({ seed: "ai-defend", galaxySize: "small", aiCount: 2 }, pack);
    const ai = s.empires[1]!;
    const intruder = newFleet(s, pack, s.empires[0]!, ["frigate", "frigate", "frigate", "frigate"], ai.homeSystemId);
    s.fleets.push(intruder);
    ai.sightings.push({ fleetId: intruder.id, empireId: 0, name: intruder.name, systemId: ai.homeSystemId, nextSystemId: null, progress: 0, ships: 4, hull: "frigate", strength: 200, armed: true, turn: s.turn });
    const strategy = decideStrategy(buildContext(s, pack, 1));
    expect(strategy.posture).toBe("defend");
    expect(strategy.threat).toBe(200);
  });

  describe("weighing strength and the endgame drive", () => {
    /** Empire 1 (an AI) with a strong fleet at home that has spotted empire 2's capital. */
    const armed = (victory: string, personality: string, defenseHp: number) => {
      const s = createInitialState({ seed: "ai-endgame", galaxySize: "small", aiCount: 2, victory }, pack);
      const ai = s.empires[1]!;
      ai.personality = personality;
      s.turn = 100;
      chartAll(s);
      s.fleets.push(newFleet(s, pack, ai, Array.from({ length: 8 }, () => "frigate"), ai.homeSystemId));
      const target = s.colonies.find((c) => c.empireId === 2 && c.capital)!;
      ai.colonySightings = [
        { colonyId: target.id, empireId: 2, systemId: target.systemId, bodyId: target.bodyId, name: target.name, population: target.population, defenseHp, troops: 5, turn: s.turn },
      ];
      return s;
    };
    const plan = (s: GameState) => decideStrategy(buildContext(s, pack, 1));

    it("counts a target colony's defenses as well as its fleets", () => {
      const own = buildContext(armed("turns200", "warlord", 0), pack, 1).ownStrength;
      expect(plan(armed("turns200", "warlord", 0)).posture).toBe("attack");
      // Defenses worth more than our fleet can take on put the attack off.
      expect(plan(armed("turns200", "warlord", own * 2)).posture).not.toBe("attack");
    });

    it("lets a strike force already on its way to the target carry on", () => {
      const s = armed("turns200", "warlord", 0);
      const ai = s.empires[1]!;
      // Move the rival colony we know of next door, well within the strike force's supply.
      const dist = buildContext(s, pack, 1).dist(ai.homeSystemId);
      const target = s.galaxy.systems.map((x) => x.id).filter((id) => id !== ai.homeSystemId).sort((a, b) => dist[a]! - dist[b]!)[0]!;
      ai.colonySightings[0]!.systemId = target;
      const strike = s.fleets.at(-1)!;
      strike.route = [target];
      strike.progress = 10;
      expect(plan(s).posture).toBe("attack");
      const orders = planAiTurn(s, pack, 1).filter((c) => c.type === "moveFleet" && c.fleetId === strike.id);
      expect(orders).toEqual([]);
    });

    it("loads troop transports at staging even when they have plotted a retreat", () => {
      const s = armed("turns200", "warlord", 0);
      const ai = s.empires[1]!;
      const dist = buildContext(s, pack, 1).dist(ai.homeSystemId);
      const next = s.galaxy.systems.map((x) => x.id).filter((id) => id !== ai.homeSystemId).sort((a, b) => dist[a]! - dist[b]!)[0]!;
      ai.colonySightings[0]!.systemId = next;
      const transport = newFleet(s, pack, ai, ["troop_transport"], ai.homeSystemId);
      transport.route = [next]; // fleeing a skirmish at home
      s.fleets.push(transport);
      const merge = planAiTurn(s, pack, 1).find((c) => c.type === "mergeFleets" && c.fleetId === transport.id);
      expect(merge).toBeDefined();
    });

    it("never drives for the endgame in games with a turn limit", () => {
      const s = armed("turns400", "turtle", 0);
      s.turn = 390;
      expect(plan(s).endgame).toBe(false);
    });

    it("drives the leader after turn 250 when it holds over half the population", () => {
      const s = armed("domination", "turtle", 0);
      s.turn = 260;
      for (const c of s.colonies) c.population = c.empireId === 1 ? 60 : 20;
      expect(plan(s)).toMatchObject({ endgame: true, posture: "attack" });
      expect(decideStrategy(buildContext(s, pack, 2)).endgame).toBe(false);
      s.turn = 250;
      expect(plan(s).endgame).toBe(false);
    });

    it("drives every AI after turn 300 once the human players hold under 20%", () => {
      const s = armed("domination", "turtle", 0);
      s.turn = 310;
      for (const c of s.colonies) c.population = c.empireId === 0 ? 30 : 35;
      expect(plan(s).endgame).toBe(false);
      for (const c of s.colonies) c.population = c.empireId === 0 ? 10 : 45;
      expect(plan(s).endgame).toBe(true);
    });

    it("still drives in an open-ended game given a safety turn cap", () => {
      const s = armed("domination", "turtle", 0);
      s.settings.turnLimit = 1000;
      s.turn = 351;
      expect(plan(s).endgame).toBe(true);
    });

    it("drives every AI after turn 350", () => {
      const s = armed("total", "turtle", 0);
      s.turn = 351;
      for (const c of s.colonies) c.population = 33;
      expect(plan(s)).toMatchObject({ endgame: true, posture: "attack" });
    });
  });

  it("creates warship designs in its personality's style", () => {
    const s = createInitialState({ seed: "ai-style", galaxySize: "small", aiCount: 4, allAI: true }, pack);
    for (const empire of s.empires) empire.techs = ["heavy_lasers", "deflector_shields", "cruiser_hulls", "composite_armor"];
    const designs = new Map<string, { hull: string; components: string[] }>();
    for (const empire of s.empires) {
      const create = planAiTurn(s, pack, empire.id).find((c) => c.type === "createDesign");
      if (create && create.type === "createDesign") designs.set(empire.personality!, create.design);
    }
    const style = (p: string) => pack.aiPersonalities.find((x) => x.id === p)!.designStyle;
    for (const [personality, design] of designs) {
      if (style(personality) === "raider") expect(design.hull).toBe("corvette");
      else expect(design.hull).toBe("cruiser");
      if (style(personality) === "fortress") expect(design.components.filter((c) => c === "deflector").length).toBeGreaterThan(0);
    }
  });
});

describe("victory", () => {
  it("ends at the turn limit with the best score winning, then refuses more turns", () => {
    const game = Game.create({ seed: "limit", galaxySize: "small", aiCount: 2, allAI: true, turnLimit: 12 }, pack);
    for (let i = 0; i < 12; i++) game.endTurn();
    const outcome = game.state.outcome!;
    expect(outcome).toMatchObject({ reason: "turnLimit", turn: 12 });
    const scores = game.state.empires.map((e) => empireScore(game.state, pack, e.id).total);
    expect(scores[outcome.winnerId]).toBe(Math.max(...scores));
    expect(game.state.lastTurnEvents.filter((e) => e.type === "gameOver")).toHaveLength(3);
    expect(applyCommand(game.state, { type: "endTurn" }, pack)).toEqual({ ok: false, error: "the game is over" });
    expect(game.endTurn()).toEqual([]);
  });

  it("awards domination to an empire holding the required share of population", () => {
    const s = createInitialState({ seed: "dom", galaxySize: "small", aiCount: 2 }, pack);
    s.turn = pack.victory.dominationMinTurn;
    s.colonies.find((c) => c.empireId === 2)!.population = 40;
    const r = applyCommand(s, { type: "endTurn" }, pack);
    if (!r.ok) throw new Error(r.error);
    expect(r.state.outcome).toMatchObject({ winnerId: 2, reason: "domination" });
  });

  describe("victory conditions", () => {
    /** Give `empireId` `percent`% of all population (every colony keeps at least 0). */
    const giveShare = (s: GameState, empireId: number, percent: number) => {
      const mine = s.colonies.filter((c) => c.empireId === empireId);
      const others = s.colonies.filter((c) => c.empireId !== empireId);
      for (const c of others) c.population = 0;
      for (const c of mine) c.population = 0;
      mine[0]!.population = percent;
      if (others.length) others[0]!.population = 100 - percent;
    };
    const check = (s: GameState, turn: number) => {
      checkVictory(s, pack, [], turn);
      return s.outcome;
    };

    it("defaults to 200 turns, with half the population winning early", () => {
      const s = createInitialState({ seed: "modes", galaxySize: "small", aiCount: 2 }, pack);
      expect(turnLimit(s, pack)).toBe(200);
      giveShare(s, 1, 60);
      expect(check(s, pack.victory.dominationMinTurn)).toMatchObject({ winnerId: 1, reason: "domination" });
    });

    it("400 turns plays on past turn 200", () => {
      const s = createInitialState({ seed: "modes", galaxySize: "small", aiCount: 2, victory: "turns400" }, pack);
      expect(turnLimit(s, pack)).toBe(400);
      expect(check(s, 200)).toBeNull();
      expect(check(s, 400)).toMatchObject({ reason: "turnLimit" });
    });

    it("domination has no turn limit and needs 75% of the population", () => {
      const s = createInitialState({ seed: "modes", galaxySize: "small", aiCount: 2, victory: "domination" }, pack);
      expect(turnLimit(s, pack)).toBeNull();
      giveShare(s, 1, 74);
      expect(check(s, 999)).toBeNull();
      giveShare(s, 1, 75);
      expect(check(s, 1000)).toMatchObject({ winnerId: 1, reason: "domination" });
    });

    it("total domination needs every last colonist", () => {
      const s = createInitialState({ seed: "modes", galaxySize: "small", aiCount: 2, victory: "total" }, pack);
      expect(turnLimit(s, pack)).toBeNull();
      giveShare(s, 2, 99);
      expect(check(s, 500)).toBeNull();
      giveShare(s, 2, 100);
      expect(check(s, 501)).toMatchObject({ winnerId: 2, reason: "domination" });
    });

    it("rejects an unknown victory condition", () => {
      expect(validateSettings({ seed: "x", galaxySize: "small", aiCount: 2, victory: "conquest" }, pack)).toMatch(/unknown victory/);
    });
  });

  it("eliminates empires with no colonies and no colony ships", () => {
    const s = createInitialState({ seed: "elim", galaxySize: "small", aiCount: 2 }, pack);
    s.colonies = s.colonies.filter((c) => c.empireId !== 1);
    s.fleets = s.fleets.filter((f) => f.empireId !== 1);
    const r = applyCommand(s, { type: "endTurn" }, pack);
    if (!r.ok) throw new Error(r.error);
    expect(r.state.empires[1]!.eliminated).toBe(true);
    expect(r.state.lastTurnEvents).toContainEqual(expect.objectContaining({ type: "empireEliminated", eliminatedId: 1, empireId: 0 }));
    expect(r.state.outcome).toBeNull();
  });

  it("lets the player disband a fleet", () => {
    const s = createInitialState({ seed: "disband", galaxySize: "small", aiCount: 2 }, pack);
    const fleet = s.fleets.find((f) => f.empireId === 0)!;
    const r = applyCommand(s, { type: "disbandFleet", empireId: 0, fleetId: fleet.id }, pack);
    expect(r.ok && r.state.fleets.some((f) => f.id === fleet.id)).toBe(false);
    expect(applyCommand(s, { type: "disbandFleet", empireId: 1, fleetId: fleet.id }, pack).ok).toBe(false);
  });
});

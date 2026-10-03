/**
 * Headless batch runner: generates many games, plays AI-only turns, verifies that
 * replaying each command log reproduces the final state, and prints galaxy stats.
 *
 *   npm run sim -- [--games 20] [--turns 50] [--size medium] [--ai 4]
 */
import { parseArgs } from "node:util";
import { Game, buildAdjacency, replay, shortestPaths, stateHash, type GameEvent, type GameSettings } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const { values } = parseArgs({
  options: {
    games: { type: "string", default: "20" },
    turns: { type: "string", default: "100" },
    size: { type: "string" },
    ai: { type: "string", default: "4" },
  },
});

const pack = defaultPack();
const games = Number(values.games);
const turns = Number(values.turns);
const sizes = values.size ? [values.size] : pack.galaxySizes.map((g) => g.id);

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (x: number) => x.toFixed(1);

let failures = 0;
for (const galaxySize of sizes) {
  const degrees: number[] = [];
  const laneLengths: number[] = [];
  const homeGaps: number[] = [];
  const deadEnds: number[] = [];
  const exploredShare: number[] = [];
  const msPerTurn: number[] = [];
  const colonies: number[] = [];
  const population: number[] = [];
  const techs: number[] = [];
  const credits: number[] = [];
  const firstColonyTurn: number[] = [];
  const eventCounts = new Map<string, number>();
  let shipsLostInBattle = 0;

  for (let g = 0; g < games; g++) {
    const settings: GameSettings = { seed: `sim-${galaxySize}-${g}`, galaxySize, aiCount: Number(values.ai), allAI: true };
    const game = Game.create(settings, pack);
    const { galaxy } = game.state;
    const adj = buildAdjacency(galaxy.systems.length, galaxy.lanes);

    degrees.push(avg(adj.map((n) => n.length)));
    deadEnds.push(adj.filter((n) => n.length === 1).length);
    laneLengths.push(...galaxy.lanes.map((l) => l.length));
    const homes = game.state.empires.map((e) => e.homeSystemId);
    for (const home of homes) {
      const { dist } = shortestPaths(adj, home);
      homeGaps.push(Math.min(...homes.filter((h) => h !== home).map((h) => dist[h]!)));
    }

    const start = performance.now();
    const firstColony = new Map<number, number>();
    for (let t = 0; t < turns; t++) {
      const events: GameEvent[] = game.endTurn();
      for (const e of events) eventCounts.set(e.type, (eventCounts.get(e.type) ?? 0) + 1);
      for (const b of game.state.lastBattles) shipsLostInBattle += b.results.reduce((n, r) => n + r.shipsLost, 0);
      for (const c of game.state.colonies) if (!c.capital && !firstColony.has(c.empireId)) firstColony.set(c.empireId, game.state.turn);
    }
    msPerTurn.push((performance.now() - start) / turns);
    for (const empire of game.state.empires) {
      const mine = game.state.colonies.filter((c) => c.empireId === empire.id);
      colonies.push(mine.length);
      population.push(mine.reduce((n, c) => n + c.population, 0));
      techs.push(empire.techs.length);
      credits.push(empire.credits);
      firstColonyTurn.push(firstColony.get(empire.id) ?? turns + 1);
    }

    const ai = game.state.empires.filter((e) => e.isAI);
    exploredShare.push(avg(ai.map((e) => e.explored.length / galaxy.systems.length)));

    if (stateHash(replay(settings, game.log, pack)) !== stateHash(game.state)) {
      failures++;
      console.error(`  DETERMINISM FAILURE: ${settings.seed}`);
    }
  }

  console.log(`\n${galaxySize}: ${games} games x ${turns} turns`);
  console.log(`  lanes per system     avg ${fmt(avg(degrees))}`);
  console.log(`  dead-end systems     avg ${fmt(avg(deadEnds))} per galaxy`);
  console.log(`  lane length          min ${Math.min(...laneLengths)}  avg ${fmt(avg(laneLengths))}  max ${Math.max(...laneLengths)}`);
  console.log(`  nearest rival home   min ${Math.min(...homeGaps)}  avg ${fmt(avg(homeGaps))} distance units`);
  console.log(`  AI explored by end   avg ${fmt(avg(exploredShare) * 100)}% of systems`);
  console.log(`  resolution time      avg ${avg(msPerTurn).toFixed(2)} ms per turn`);
  const range = (xs: number[]) => `min ${Math.min(...xs)}  avg ${fmt(avg(xs))}  max ${Math.max(...xs)}`;
  console.log(`  colonies per empire  ${range(colonies)}`);
  console.log(`  population           ${range(population)}`);
  console.log(`  techs researched     ${range(techs)}`);
  console.log(`  treasury at end      ${range(credits)}`);
  console.log(`  first new colony     ${range(firstColonyTurn)} (turn)`);
  const perEmpireGame = games * (Number(values.ai) + 1);
  const ev = (k: string) => fmt((eventCounts.get(k) ?? 0) / perEmpireGame);
  console.log(`  per empire per game  ships ${ev("shipCompleted")}  buildings ${ev("buildingCompleted")}  starving turns ${ev("starvation")}  debt turns ${ev("inDebt")}`);
  console.log(`  military per empire  battles ${ev("battle")}  blockades ${ev("blockaded")}  intercepted ${ev("fleetIntercepted")}  ran dry ${ev("outOfSupply")}  attrition ${ev("attrition")}`);
  console.log(`  ships lost in battle ${fmt(shipsLostInBattle / perEmpireGame)} per empire per game`);
}

console.log(failures === 0 ? "\nAll replays matched." : `\n${failures} replay mismatches.`);
process.exit(failures === 0 ? 0 : 1);

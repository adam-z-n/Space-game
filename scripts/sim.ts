/**
 * Headless batch runner: generates many games, plays AI-only turns, verifies that
 * replaying each command log reproduces the final state, and prints galaxy stats.
 *
 *   npm run sim -- [--games 20] [--turns 50] [--size medium] [--ai 4]
 */
import { parseArgs } from "node:util";
import { Game, buildAdjacency, replay, shortestPaths, stateHash, type GameSettings } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const { values } = parseArgs({
  options: {
    games: { type: "string", default: "20" },
    turns: { type: "string", default: "50" },
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

  for (let g = 0; g < games; g++) {
    const settings: GameSettings = { seed: `sim-${galaxySize}-${g}`, galaxySize, aiCount: Number(values.ai) };
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
    for (let t = 0; t < turns; t++) game.endTurn();
    msPerTurn.push((performance.now() - start) / turns);

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
}

console.log(failures === 0 ? "\nAll replays matched." : `\n${failures} replay mismatches.`);
process.exit(failures === 0 ? 0 : 1);

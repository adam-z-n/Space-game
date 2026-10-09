/**
 * Headless batch runner and balance harness. Plays all-AI games to the end,
 * verifies that replaying each command log reproduces the final state, and
 * reports galaxy, economy, combat and win-rate statistics.
 *
 *   npm run sim -- [--games 20] [--turns 200] [--size medium] [--ai 4] [--difficulty normal]
 *                  [--open-research]   (every species gets full research access: a balance control)
 */
import { parseArgs } from "node:util";
import { Game, buildAdjacency, empireScore, replay, shortestPaths, stateHash, type GameEvent, type GameSettings } from "../src/core";
import { defaultPack } from "../src/content/defaultPack";

const { values } = parseArgs({
  options: {
    games: { type: "string", default: "20" },
    turns: { type: "string" },
    size: { type: "string" },
    ai: { type: "string", default: "4" },
    difficulty: { type: "string", default: "normal" },
    "open-research": { type: "boolean", default: false },
  },
});

const pack = defaultPack();
if (values["open-research"]) for (const species of pack.species) species.research = { access: "full", affinityPercent: 0 };
const games = Number(values.games);
const sizes = values.size ? [values.size] : pack.galaxySizes.map((g) => g.id);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (x: number) => x.toFixed(1);
const range = (xs: number[]) => `min ${Math.min(...xs)}  avg ${fmt(avg(xs))}  max ${Math.max(...xs)}`;

let failures = 0;
for (const galaxySize of sizes) {
  const stats = {
    homeGaps: [] as number[],
    length: [] as number[],
    colonies: [] as number[],
    techs: [] as number[],
    credits: [] as number[],
    msPerTurn: [] as number[],
    shipsLost: 0,
    rejections: 0,
  };
  const reasons = new Map<string, number>();
  const events = new Map<string, number>();
  const baseline = { games: 0, wins: 0 };
  let landings = 0;
  let captures = 0;
  let capitalMoves = 0;
  const byPersonality = new Map<string, { games: number; wins: number; score: number; colonies: number; debtTurns: number; battles: number }>();
  const bySpecies = new Map<string, { games: number; wins: number; score: number; techs: number; colonies: number }>();
  let techsCaptured = 0;

  for (let g = 0; g < games; g++) {
    const settings: GameSettings = {
      seed: `sim-${galaxySize}-${g}`,
      galaxySize,
      aiCount: Number(values.ai),
      allAI: true,
      // Rotate which empire (and so species) empire 0 plays, so every species gets a fair sample.
      playerEmpire: g % pack.empires.length,
      difficulty: values.difficulty,
      ...(values.turns ? { turnLimit: Number(values.turns) } : {}),
    };
    const game = Game.create(settings, pack);
    const { galaxy } = game.state;
    const adj = buildAdjacency(galaxy.systems.length, galaxy.lanes);
    const homes = game.state.empires.map((e) => e.homeSystemId);
    for (const home of homes) {
      const { dist } = shortestPaths(adj, home);
      stats.homeGaps.push(Math.min(...homes.filter((h) => h !== home).map((h) => dist[h]!)));
    }
    const debt = new Map<number, number>();
    const battles = new Map<number, number>();

    const start = performance.now();
    let turns = 0;
    while (!game.state.outcome) {
      const evs: GameEvent[] = game.endTurn();
      turns++;
      for (const e of evs) {
        events.set(e.type, (events.get(e.type) ?? 0) + 1);
        if (e.type === "invasion" && e.empireId === e.attackerId) {
          landings++;
          if (e.captured) captures++;
        }
        if (e.type === "capitalMoved") capitalMoves++;
        if (e.type === "techCaptured") techsCaptured++;
        if (e.type === "inDebt") debt.set(e.empireId, (debt.get(e.empireId) ?? 0) + 1);
        if (e.type === "battle") battles.set(e.empireId, (battles.get(e.empireId) ?? 0) + 1);
      }
      for (const b of game.state.lastBattles) stats.shipsLost += b.results.reduce((n, r) => n + r.shipsLost, 0);
    }
    stats.msPerTurn.push((performance.now() - start) / turns);
    stats.length.push(game.state.outcome!.turn);
    stats.rejections += game.aiRejections.length;
    baseline.games++;
    if (game.state.outcome!.winnerId === 0) baseline.wins++;
    reasons.set(game.state.outcome!.reason, (reasons.get(game.state.outcome!.reason) ?? 0) + 1);

    for (const empire of game.state.empires) {
      const score = empireScore(game.state, pack, empire.id);
      stats.colonies.push(score.colonies);
      stats.techs.push(score.techs);
      stats.credits.push(empire.credits);
      const key = empire.personality ?? "human";
      const row = byPersonality.get(key) ?? { games: 0, wins: 0, score: 0, colonies: 0, debtTurns: 0, battles: 0 };
      row.games++;
      row.wins += game.state.outcome!.winnerId === empire.id ? 1 : 0;
      row.score += score.total;
      row.colonies += score.colonies;
      row.debtTurns += debt.get(empire.id) ?? 0;
      row.battles += battles.get(empire.id) ?? 0;
      byPersonality.set(key, row);
      const sp = bySpecies.get(empire.species) ?? { games: 0, wins: 0, score: 0, techs: 0, colonies: 0 };
      sp.games++;
      sp.wins += game.state.outcome!.winnerId === empire.id ? 1 : 0;
      sp.score += score.total;
      sp.techs += empire.techs.length;
      sp.colonies += score.colonies;
      bySpecies.set(empire.species, sp);
    }

    if (stateHash(replay(settings, game.log, pack)) !== stateHash(game.state)) {
      failures++;
      console.error(`  DETERMINISM FAILURE: ${settings.seed}`);
    }
  }

  const perEmpire = games * (Number(values.ai) + 1);
  const ev = (k: string) => fmt((events.get(k) ?? 0) / perEmpire);
  console.log(`\n${galaxySize}: ${games} games, ${values.difficulty} difficulty`);
  console.log(`  game length          ${range(stats.length)} turns`);
  console.log(`  how games ended      ${[...reasons].map(([r, n]) => `${r} ${n}`).join(", ")}`);
  console.log(`  nearest rival home   ${range(stats.homeGaps)} distance units`);
  console.log(`  colonies at end      ${range(stats.colonies)}`);
  console.log(`  techs at end         ${range(stats.techs)}`);
  console.log(`  treasury at end      ${range(stats.credits)}`);
  console.log(`  per empire per game  battles ${ev("battle")}  blockades ${ev("blockaded")}  intercepted ${ev("fleetIntercepted")}  debt turns ${ev("inDebt")}  starving ${ev("starvation")}`);
  console.log(`  ships lost in battle ${fmt(stats.shipsLost / perEmpire)} per empire per game`);
  // Invasion events go to both sides, so count each landing once (from the attacker's copy).
  console.log(`  invasions            ${fmt(landings / games)} per game, ${fmt(captures / games)} colonies captured per game, defenses knocked out ${ev("defensesDown")} per empire, mine hits ${ev("mineHits")} per empire, capitals lost ${fmt(capitalMoves / games)} per game`);
  console.log(`  resolution time      ${avg(stats.msPerTurn).toFixed(1)} ms per turn (including AI)`);
  console.log(`  AI command rejections ${stats.rejections}`);
  const proxy = baseline.games ? fmt((baseline.wins * 100) / baseline.games) : "-";
  const fair = fmt(100 / (Number(values.ai) + 1));
  console.log(`  baseline empire (no difficulty modifiers) won ${proxy}% of games (an even share is ${fair}%)`);
  console.log(`  personality       games  win%   score  colonies  debt turns  battles`);
  for (const [name, r] of [...byPersonality].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games)) {
    console.log(
      `  ${name.padEnd(16)} ${String(r.games).padStart(5)}  ${fmt((r.wins * 100) / r.games).padStart(5)}  ${String(Math.round(r.score / r.games)).padStart(6)}  ${fmt(r.colonies / r.games).padStart(8)}  ${fmt(r.debtTurns / r.games).padStart(10)}  ${fmt(r.battles / r.games).padStart(7)}`,
    );
  }
  console.log(`  techs captured by conquest: ${fmt(techsCaptured / games)} per game`);
  console.log(`  species           games  win%   score  techs  colonies`);
  for (const [name, r] of [...bySpecies].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games)) {
    console.log(
      `  ${name.padEnd(16)} ${String(r.games).padStart(5)}  ${fmt((r.wins * 100) / r.games).padStart(5)}  ${String(Math.round(r.score / r.games)).padStart(6)}  ${fmt(r.techs / r.games).padStart(5)}  ${fmt(r.colonies / r.games).padStart(8)}`,
    );
  }
}

console.log(failures === 0 ? "\nAll replays matched." : `\n${failures} replay mismatches.`);
process.exit(failures === 0 ? 0 : 1);

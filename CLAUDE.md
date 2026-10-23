# Notes for Claude

Working memory for Claude Code sessions on this repo. Read this first; the README, `docs/GAME_DESIGN.md`,
`docs/ROADMAP.md` and `CHANGELOG.md` hold the details.

## The project

A turn-based 4X space strategy game for phones, built web-first in TypeScript (Vite) and served from GitHub Pages.
Capacitor wrapping for the app stores comes later. The simulation lives in `src/core` (deterministic, plain-JSON
state, all changes through commands); the rules data lives in `content/default/pack.json` (validated by zod in
`src/content/schema.ts`); the UI is plain DOM in `src/web`.

## Where things stand

- **Released:** v1.0.0, v1.3.0 (which includes 1.1 and 1.2) and v1.4.0 (once its release PR merges and the owner
  tags it). The owner publishes releases through the GitHub UI.
  To release: a small PR that bumps `version` (`npm version X.Y.Z --no-git-tag-version`) and retitles the changelog
  section; after it merges the owner creates the release and tag (tag pushes from sessions get a 403), and the
  deploy archives that build under `/vX.Y/`.
- **1.2 contents:** resupply only at colonies, depots and supply ships; ship experience and ranks; Fleet Command
  Network; 118-tech tree with rival schools, race research access and affinities (balance-tested); conquest tech
  capture; missile ammo, component knock-outs, pursuit, fleet size limit (warships only); supply ships rearm and
  (with Field Repair) repair in the field, repair tenders removed; victory modes (200 turns, 400 turns,
  Domination 75%, Total domination 100%); AI weighs planetary defenses; AI endgame drive in open-ended modes;
  several AI attack fixes; AI warship cap of 60.
- **1.3 contents:** invasions land only the troops needed (125% of defenders) or
  all-out; unarmed fleets hold behind friendly warships; ship batches ×1/×3/×5 (queue item `count`); Planets
  screen; resupply points shown when a fleet is selected; galaxy types (content `galaxyTypes`: standard, sparse,
  dense, clusters, spiral, ring); AI siege bombing, commando raids, depots; AI coalition against a leading human
  in open-ended games (`state.coalition`, content `victory.coalition`); research costs scaled by tree depth.
- **1.4 contents:** scroll kept on redraw, planet details on the colony screen,
  Planets population column, stalled-invasion fix; combat: retreat the way you came (`fleet.cameFrom`),
  unescorted freighters destroyed (hull `freighter`), no holding orbit under working colony guns; bombing can
  destroy colonies, plague bombs and blight (`body.blight`, flag `cureBlight`), planet cracker (component `size`);
  gas giant habitats, Microfabrication / Molecular Assembly slots, warp gates (`fleet.warp`); four research-boost
  techs repurposed; nine new weapons (specials pin/emp/nanite/area/ion/phase, flak, heavy mines, satellites);
  How to play screen and first-game tips (`src/web/help.ts`). State version 17.
- **1.5 in progress:** the fleet command overhaul, approved design in `docs/FLEET_COMMAND.md` (revision 3, softer
  mark steps). Build plan in its section 11. Part 1 (core rules, state version 18, basic AI so it stays valid) is
  done; next are part 2 (combat: flagship loss in battle, Chain of Command, officer experience, cohesion, flagship
  targeting and screening, network bonus and oversize penalty), part 3 (AI), part 4 (screens: the web UI has no
  buttons yet for placing commands, forming fleets or outpost marks) and part 5 (balance sims, changelog).
- **Next ideas** (`docs/ROADMAP.md`): diplomacy, espionage, trade, pass-and-play multiplayer; combat terrain,
  ambush, admirals, boarding.

## How the owner likes to work

- For a new version, the owner sends a list of goals. Brainstorm and propose a design first (options, tables of
  numbers) and wait for approval before coding big features. Then build it in parts, each committed and pushed.
- Balance claims need evidence: run the batch sim and report before/after tables. The owner asked for race
  balance tests; keep using the same seeds when comparing.
- Ask before design decisions that are really theirs; otherwise pick a sensible default and say so.
- One pull request per version (or per round of changes) against `main`; the owner merges it.
- Keep `CHANGELOG.md` and `docs/ROADMAP.md` current. Ideas the owner defers go into the roadmap.

## Repo conventions

- Develop on the branch the session is given; commit and push as work completes. Never push to `main`.
- Commit messages: plain summary line, a short body explaining why, then the attribution trailers the session
  provides. Never put model names in commits, PRs or code.
- PR bodies: what changed and how it was tested (tests, sim numbers, screenshots checked), then the attribution
  lines the session provides.
- CI (`.github/workflows/ci.yml`) runs typecheck, tests, a 10-game determinism sim and a build. Merges to `main`
  deploy to Pages; archived release builds are served under `/vX.Y/` with their own save keys.

## Simulation rules (enforced by tests)

- All randomness from the seeded `Rng`; no `Math.random`, clocks, or trig/exp/log/pow in `src/core`.
- Iterate in a fixed order and break ties by id. Replays must reproduce the final state hash.
- Changing persisted state means bumping `STATE_VERSION` in `src/core/state.ts` (now 18) and adding a step to
  `migrateState` in `src/core/save.ts`, with a test.
- New content fields go in the zod schema (with `superRefine` checks for cross-references). New effect keys must
  also be added to the effect list in `src/core/economy.ts`.
- The AI uses only what its empire knows (`buildContext` in `src/core/ai/context.ts`), never hidden state.

## Tools and testing

- `npm run typecheck`, `npm test` (vitest; about 440 tests), `npm run build`.
- `npm run sim -- --games N --size small|medium|large --ai 4 --turns 150` plays all-AI games, checks replays, and
  reports by personality and by race (empire 0 rotates through the races). Extra flags: `--victory <mode>`
  (open-ended modes are capped at 1000 turns), `--open-research` (every race gets full research access; a balance
  control). A 60-game small run takes about 15 minutes; run two or three in parallel at most (4 cores).
- Before/after sims: `git worktree add <scratchpad>/base <commit>`, symlink `node_modules` into it, and run the same
  sim command in both trees in parallel (same seeds). For a full-tree research check, a probe script playing
  Total domination games capped at 400 turns logs each empire's tech count over time (8 small and 4 medium games
  take about 2 hours).
- `tests/helpers.ts` has `testPack`, `testFleet`, `relocateCapitals`, `chartAll`, and `enlist`/`enlistFor` (put a
  fleet in a naval command without the forming rules, for tests of attacks). Full AI-game tests need a
  `30_000` ms timeout.
- AI tuning knobs: `ENDGAME` in `src/core/ai/strategy.ts`, `AI_MAX_WARSHIPS` in `src/core/ai/production.ts`,
  attack planning in `attack()` in `src/core/ai/operations.ts`.

## Gotchas

- `pkill -f <pattern>` and `ps | grep | xargs kill` can match the shell running the command and kill it (exit
  144). Find PIDs first, filter out `bash -c`, then kill by PID.
- Throwaway `tsx` scripts must live inside the repo (for example `scripts/<name>.tmp.ts`, deleted afterwards):
  from the scratchpad, `defaultPack()` can't find the content pack.
- Vitest hides `console.log` from passing tests; write debug output to a file or use a `tsx` script.
- The batch sim prints only at the end. For long open-ended games, write a small probe script that logs
  progress every 100 turns.
- Screenshots: `npm run build`, then `npx vite preview --port 4173` in the background, then a Playwright script
  (`require` from `/opt/node-tools/node_modules/playwright`, iPhone 13 device). To show a mid-game
  state, write a save with a `tsx` script and put it in `localStorage` under `space4x:save:autosave` before loading. The preview server sometimes stops; restart it.

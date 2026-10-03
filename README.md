# Space 4X (working title)

A turn-based space empire game for phones. See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for the design.

The game is built web-first in TypeScript: it runs as a mobile web app for playtesting, and will be wrapped
with Capacitor for the iOS and Android app stores later using the same code.

## Status: Milestone 4

**Milestone 4: ship design, fleets, supply, combat**

- Ship designs: pick a hull (slots, structure, speed, evasion, endurance), fill slots with weapons, armor,
  shields, engines, sensors, colony modules or fuel tanks, and set a formation role. Designs can be copied and retired.
- Fleets hold many ships; merge and detach in the fleet sheet. Fleet speed is the slowest ship.
- Supply: colonies project supply along lanes (capital further than other colonies; techs extend it).
  Outside supply a fleet burns a turn of onboard supply per turn; once empty it is slowed, deals half damage
  and loses hull each turn. Tankers add endurance. Supplied fleets repair, faster when docked at a colony.
- Blockades: an enemy warship in orbit with no defender cuts a colony's supply and trade.
- Interception: armed fleets on engage orders stop enemy fleets entering their system.
- Combat is auto-resolved over several rounds with seeded randomness: per-fleet mission (engage/evade),
  stance, target priority and retreat threshold; formation roles decide who draws fire; shields, armor and
  evasion matter. Each battle has a report with a round-by-round replay.
- Pre-battle odds when previewing a move, based only on what your sensors have seen (and how old that intel is),
  plus warnings about enemy fleets that will stop you on the way.
- Weapons, defense, hull and logistics techs; the placeholder AI designs warships, guards its space,
  intercepts weaker intruders and blockades rival colonies.

**Milestone 3: colonies, economy, research**

- Colonies with population, growth, and a focus (balanced, industry, research, food) that assigns workers automatically
- Four resources: industry (builds things at each colony), research (empire-wide), food (shared stock; shortages
  cause starvation), credits (taxes minus upkeep; debt cuts output)
- Build queues per colony with turn forecasts; buy the current build with credits
- Colony ships settle planets above a habitability threshold (techs lower it)
- A 16-tech tree in six fields; techs add bonuses or unlock buildings, all defined in the content pack
- Rival colonies are seen through sensors, with last-known sightings like fleets
- Resource bar, colony and research screens, empire finances, and a "to do" queue covering research,
  empty build queues, colony ships and idle fleets
- The placeholder AI researches, builds, buys and expands, so batch runs report colonies, population and techs

**Milestone 2: map and orders**

- Fog of war: star charts are known, but planets show only once explored and rival fleets only within sensor range
  (home system and your fleets). Out of range, you keep last-known sightings.
- Select fleets and stars on the map; tap a star to preview a route with turns to arrive, then confirm
- Drag from a fleet to a star to order it directly; long-press stars and fleets for context actions
- Hold orders and an attention queue ("2 idle ›") so ending a turn is never a guess
- Fleets list, turn report with tap-to-locate, readable labels at any zoom
- A debug "Reveal map" option in the menu
- Older saves are migrated automatically

**Milestone 1: simulation core**

- Seeded, reproducible galaxy generation (systems, lanes, planets, home systems)
- The command pipeline and turn loop: every action is a serializable command applied to a deterministic state
- Fleet movement along lanes, with mid-lane redirects
- A placeholder AI that explores, using the same commands as the player
- Saves (current state plus full command log), undo within a turn, and replay from the log
- A data-driven content pack, validated at load
- Headless tests and a batch simulation runner
- A preview web app with autosave and save export/import

Not yet: orbital and planetary defenses, invasion, repair tenders and minelayers (Milestone 6), and a real AI (Milestone 5).

## Play it

The latest `main` is published at **https://adam-z-n.github.io/Space-game/**. Open it on a phone and use
"Add to Home Screen" for a full-screen app. Saves live in that browser only; use Menu → Export save file to keep one.

## Running it

Requires Node 20 or newer.

```sh
npm install
npm run dev        # web app at http://localhost:5173 (add -- --host to open it from a phone on the same network)
npm test           # unit tests
npm run sim        # headless batch: AI-only games, determinism check, galaxy stats
npm run typecheck  # includes a check that the simulation core uses no browser/Node APIs
npm run build      # production web build in dist/
```

`npm run sim -- --games 50 --turns 100 --size large --ai 5` adjusts the batch.

## Layout

| Path | What it is |
| --- | --- |
| `src/core/` | The simulation: state, RNG, galaxy generation, commands, turn resolution, fog of war, AI, saves. No UI or platform code. |
| `src/core/economy.ts` | Colony output, production, research, food, credits and growth. The UI's forecasts call the same functions. |
| `src/core/ships.ts` | Designs, design stats, fleet stats and strength. |
| `src/core/supply.ts` | Supply networks, onboard supply, repair, attrition, blockades. |
| `src/core/combat.ts` | Battle resolution and battle reports. |
| `src/core/view.ts` | What one empire may know. The UI renders only this, so fog of war can't leak. |
| `src/content/` | Content pack schema and loader. |
| `content/default/pack.json` | The placeholder content pack (stars, planets, names, empires, starting fleets). |
| `src/platform/` | Save storage and app lifecycle. The only code that changes for the native app. |
| `src/web/` | The web UI: galaxy map, HUD, colony/research/empire screens, ship designer, fleet orders, battle replays. |
| `tests/` | Unit tests. |
| `scripts/sim.ts` | Headless batch runner. |

## Rules for the simulation core

These keep games replayable and multiplayer-ready:

- All randomness comes from `Rng` (seeded, state stored in `GameState`). Never `Math.random`.
- No clock reads, and no trig/exp/log/pow (their results can differ between JS engines). `Math.sqrt` is fine.
- State is plain JSON. Changes happen only through commands in `applyCommand`.
- Iterate arrays in a fixed order; break ties by id.

`tests/purity.test.ts` and `tsconfig.core.json` enforce the mechanical parts of this.

## Decisions so far

- Engine: TypeScript, web-first, Capacitor for native builds later.
- Galaxy sizes: about 24 / 48 / 80 systems (tunable in the content pack).
- Resources: industry, research, food, credits.
- Colony management uses focus presets rather than per-worker sliders, to keep it one-thumb friendly.
- Every empire is hostile to every other; diplomacy is out of scope for v1.
- Fleet orders in v1: engage/evade, stance, target priority and retreat threshold. Patrol, escort and raid
  missions are deferred; blockades happen automatically when a warship sits at an enemy colony.
- First theme: undecided; a generic placeholder pack is used for now.

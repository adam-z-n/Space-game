# Game Design Document: Space 4X (working title)

Oct 2, 2026

## Vision and pillars

A turn-based space empire game for phones, in the Master of Orion tradition, where wars are won by operational planning: supply, positioning, and the right mix of ships, not by twitch tactics.

**Pillars**

1. **Operational warfare.** Fleet composition, logistics, and orders decide battles before they start.
2. **Specialized ships.** Combat, transport, recon, and support roles each matter and counter one another.
3. **Readable depth.** Every decision is surfaced clearly on a small screen; complexity lives in the systems, not the UI.
4. **Themeable.** A theme is a content pack (species, ships, tech, art, text) over a fixed rules engine.

## Scope and platform

v1 is a single-player game against AI empires on iOS and Android, with the simulation built so multiplayer can be added later.

- **In v1:** one galaxy size range, 2-5 AI opponents, full economy, research, ship design, operational combat, and defenses.
- **Deferred:** multiplayer, campaign scenarios, and additional themes beyond the first.
- **Multiplayer readiness:** all player actions are serializable commands applied to a deterministic game state, so async play can be added without rewriting the rules.
- **Mobile constraints:** portrait and landscape support, touch-first input, saves that survive app suspension, and a session target of 10-20 minutes.

## Core loop and turn structure

Turns are classic sequential: you plan and issue all orders, end the turn, then AI empires act and the world resolves.

1. **Orders phase.** Set production and research, move fleets, issue operational orders.
2. **Resolution phase.** Movement, supply, combat (auto-resolved), invasions, then economy and growth.
3. **Report phase.** A short summary of events needing attention: battles, arrivals, finished builds, discoveries.

The loop is explore, expand, exploit, exterminate. Reports and an attention queue keep each turn to under a minute in the early game.

## Galaxy, systems and planets

The galaxy is a procedurally generated graph of star systems linked by lanes, seeded for reproducibility.

- **Sizes:** small (about 24 systems), medium (about 48), large (about 80). Final numbers get tuned in playtests.
- **Systems** hold 0-5 bodies: planets, asteroid fields, gas giants, anomalies.
- **Planets** have type, size, richness, and environment, which set habitability and yield per species.
- **Chokepoints and distance** matter: lane length drives travel time and supply cost.
- **Fog of war:** you see only what your scouts, colonies, and sensors cover; the rest shows last-known data.

## Economy, colonies and research

Colonies grow population and produce a small set of resources; empire-level choices set how output is spent.

- **Resources:** industry, research, food, and credits as a starting set. Keep it to four or fewer for mobile readability.
- **Colony management:** per-colony focus sliders with sensible auto-assignment so players can ignore minor colonies.
- **Production queues:** buildings, ships, defenses, and troops, with clear turns-to-complete.
- **Research:** a branching tech tree in several fields (for example weapons, propulsion, sensors, logistics, defense, growth). Each tech unlocks or upgrades items defined in data.

## Ships and fleets

Ships are built from hulls with component slots; roles are distinct enough that fleet mix is a real decision.

| Role | Examples | Job |
| --- | --- | --- |
| Combat | Frigate, cruiser, battleship, carrier | Destroy enemy forces and defenses |
| Transport | Troop ship, cargo hauler, colony ship | Move troops, supplies, settlers |
| Recon | Scout, picket | Extend vision, detect stealth |
| Support | Tanker, supply ship, minelayer | Extend range, resupply, rearm and repair in the field, deny space |

- **Ship design:** pick a hull, fill slots (weapons, armor, shields, engines, sensors, cargo), and save the design as a template.
- **Fleets:** ships group into fleets with shared speed, supply draw, and orders. Fleet speed is its slowest ship.
- **Upkeep:** ships cost production or credits per turn, so size is a trade-off.

## Logistics and supply

Supply is the main differentiator: fleets fight best near home, and projecting power costs real resources.

- **Supply range:** colonies and bases project a supply zone. Fleets inside it are fully supplied; outside it they draw down onboard supply.
- **Out of supply:** combat effectiveness and speed degrade, then ships take attrition.
- **Tankers and supply depots** extend range; **forward bases** create new supply hubs.
- **Transports** move troops, cargo, and colonists along lanes and can be intercepted, so escorts and lane control matter.
- **Recon** reveals enemy fleet strength, supply lines, and defenses, which feeds combat odds estimates shown to the player.

## Operational combat

Combat is auto-resolved. The player's influence comes from the orders and setup chosen before contact, not from controlling the battle.

- **Orders:** attack, defend, patrol, escort, blockade, raid, retreat-on-threshold.
- **Stance:** aggressive, balanced, or cautious, which shifts damage, defense, and retreat behavior.
- **Targeting priority:** per fleet, such as warships first, transports first, defenses first.
- **Formation role:** ships are tagged front line, support, or screen, which affects who takes fire.
- **Resolution:** a multi-round model over weapon, armor, shield, speed, and supply modifiers, using seeded RNG. Output is a short battle report with losses and a replayable log.
- **Pre-battle odds:** a fog-aware estimate shown before committing a fleet.

## Orbital and planetary defense

Defenses make holding territory cheaper than taking it, so attackers need preparation.

- **Orbital:** defense platforms, minefields, sensor arrays, and shield generators, built per system.
- **Planetary:** ground batteries, planetary shields, and garrisons.
- **Invasion:** defenses must be reduced in orbit first, then troop transports land. Ground combat is auto-resolved from troop strength, tech, and terrain.
- **Blockade:** an uncontested enemy fleet in orbit cuts a colony's supply and trade.

## AI opponents

AI empires use the same commands and rules as the player, with no hidden shortcuts at normal difficulty.

- **Structure:** a strategic layer (expansion, research, war goals) over an operational layer (fleet assignment, targets, supply).
- **Personalities:** data-defined weights such as expansionist, turtle, raider, so opponents feel different.
- **Difficulty:** higher levels add resource bonuses or better scouting information; none break fog-of-war rules by default.
- **Testing:** AI-vs-AI batches are the main balance tool.

## Themes and data-driven content

A theme is a content pack. The rules engine stays fixed; ships, species, tech, buildings, events, art, and text come from data files.

- **Format:** JSON or YAML, validated against schemas at load time.
- **Pack contents:** species and traits, hull and component definitions, tech tree, building and defense lists, names, text, and art references.
- **Rules vs content:** new ship types and techs should need no code. New mechanics are the only reason to touch the engine.
- **Balance:** each pack is validated by the headless simulation harness before release.

## Mobile UX

A dense 4X has to be usable with one thumb.

- **Main screens:** galaxy map, system view, colony, research, ship design, fleet list, turn report.
- **Map:** pan and zoom, tap to select, long-press for context actions, drag to set fleet destinations with a route preview.
- **Minimum touch target** of about 44 pt; bottom-anchored action bars; no hover-dependent UI.
- **Attention queue:** idle fleets, empty build queues, and finished research are listed, so "end turn" is never a guess.
- **Sessions:** autosave every turn and resume instantly after backgrounding.

## Technical architecture

The simulation is a standalone library with no UI dependencies; the client only renders state and submits commands.

- **Simulation core:** pure game state plus a command-and-resolve pipeline, runnable headless.
- **Determinism:** seeded RNG, no wall-clock or unordered iteration in rules code, so any game can be replayed from its seed and command log.
- **Commands:** every player and AI action is a serializable command, which also enables saves, undo within a turn, and later multiplayer.
- **Data layer:** content packs loaded and validated at startup.
- **Client:** rendering, input, and UI over the core; engine choice (Godot 4 is the current leading candidate) is still open.
- **Test harness:** unit tests for rules, plus batch AI-vs-AI runs that report win rates and combat statistics.

## Milestones and open questions

Each milestone ends in something playable.

1. **M1:** galaxy generation, system data, turn loop, headless tests.
2. **M2:** minimal map UI with select, move, and end turn.
3. **M3:** colonies, economy, research.
4. **M4:** ship design, fleets, supply, operational combat.
5. **M5:** AI opponent and balance harness.
6. **M6:** defenses, invasion, support ships, first theme pass.
7. **M7:** mobile builds, performance, polish.

**Open questions**

- Engine: Godot 4 versus TypeScript with Capacitor.
- Galaxy sizes and target session length.
- Final resource list.
- Theme and setting for the first content pack.

# Changelog

## 1.1.0

Map and planning:

- Fog of war now hides everything outside your sensor coverage: you see only charted systems (ever in sensor range,
  or one lane from a system you visited) and the lanes between them. Fleets can only plan routes through charted space.
- Systems are colored by what you know: grey until visited, then green (a planet you can colonize now), yellow
  (only planets that need more research) or dark blue (no planets). Colors update as you research.
- Research tree screen (menu, or "Full research tree" on the research screen): every tech by field, with status,
  prerequisites and what it unlocks.
- Colonization planner (menu): unclaimed planets you know about with size, type, minerals, max population and travel
  time, plus an option to show planet values on the map.
- When a tech unlocks a building, the turn report and research screen offer to queue it at every colony in one tap.
- Rename fleets from the fleet sheet.

Colonization:

- Fixed: Barren, Toxic and Volcanic worlds could never be colonized (Terraforming didn't lower the requirement enough).
  Controlled Environments (new) opens Barren worlds; Terraforming opens Toxic and Volcanic ones.
- Colony bases: a colony can build a colony base to settle another habitable planet in its own system, no colony ship needed.

Finances:

- Tax levels (Empire screen): Low, Normal, High and Crushing trade income against growth and output.
- Surplus food is sold instead of wasted. Set a food reserve on the Empire screen; food above it sells for half a credit.
- Place workers by hand: "+" on a job moves a worker to it from the busiest other job; "Auto" hands control back to the focus.
- Scrap buildings for a quarter of their cost back; their upkeep stops.
- Scrapping a fleet inside your supply network returns a quarter of its ships' cost.
- The Empire screen breaks income down by source: taxes, idle industry, food sales and upkeep.

Combat and tactics:

- Battles now have range. They open at long range; each round the side with the better maneuver (its slowest
  armed line ship) moves the range one step toward what suits its weapons. Weapons fire only within their range:
  missiles reach long range, beams medium, mass drivers, gauss cannons and disruptors only short range.
- Formations matter: front line ships draw most fire; screens take half the shots aimed at the support ships
  behind them; support ships hang back, are targeted least and get +10% evasion.
- Hulls have maneuver (Escort 5 down to Dreadnought 1), which also adds evasion. Combat Thrusters and Inertial
  Dampers raise it.
- New weapons and equipment (16 new techs): Gauss Cannons and Disruptors (pierce shields), Hellfire Missiles and
  Starburst Torpedoes, Plasma Lances, Fighter Bays and Strike Drones for cruisers and larger (they hunt support
  ships and slip past screens), Point Defense (shoots down missiles and fighters), Targeting Computers, ECM Jammers,
  Cyber Warfare Suites and Hardened Firewalls, Crystalline Armor, Deflector V, Combat Thrusters.
- Orbital bombardment: cruisers and larger can carry bomb bays and bombard a colony whose defenses are down,
  killing population, garrison and buildings to soften it for invasion.
- Every colony now has planetary batteries that grow with its population, so ships can't sit unopposed at an
  enemy colony; any colony with standing guns, and any armed enemy fleet, stops ships passing through its system.
- Retreating fleets fall back to the nearest friendly or empty system, avoiding enemy colonies and fleets.
- A failed invasion costs the defenders garrison and militia, which take turns to recover; garrisons refill more slowly.
- Battle replays show the range each round, ships shut down by cyber attack, and missiles shot down.
- The ship designer explains each formation and shows maneuver; components too big for a hull are marked.

Strategic map:

- Bigger galaxies: 32, 64 and 100 systems (were 24, 48 and 80); about 30% of systems have no planets at all,
  only asteroid fields, gas giants, anomalies or nothing.
- Outposts (Outpost Construction, then Asteroid Mining and Forward Depots), built by Outpost Ships on asteroid
  fields and gas giants:
  - Combat outposts: guns and 60 hit points, fire on enemy ships, stop ships passing through and extend sensors.
  - Mining outposts: +4 credits a turn, but no defenses: any armed enemy fleet in the system destroys them
    unless your own warships or a combat outpost guard it.
  - Supply depots: upgrade a combat outpost for 60 credits to supply and repair your fleets nearby.
- Special operations (Special Operations and Cloaking):
  - Cloaking Devices (small hulls only): a fleet made only of cloaked ships is seen only at a third of normal
    sensor range, slips past blockades and stays out of battle unless set to engage.
  - Commando Teams sabotage a rival colony each turn in orbit: knock out half its orbital defenses, halve its
    garrison and scatter its militia, or wreck a building. A failed raid costs a ship. The Infiltrator design
    combines both.
- The AI builds outposts in its supply network.

## 1.0.0

The first complete version: Milestones 1 to 6 and the classic space opera theme.

- Seeded galaxies in three sizes, fog of war, fleet orders with route previews, undo and autosave
- Colonies, four resources, build queues and a research tree
- Ship design, fleets, supply, blockades, interception and auto-resolved battles with replays
- AI opponents with five personalities, three difficulty levels and domination, elimination or turn-limit victory
- Colony defenses, invasions, minefields and support ships
- Classic retro look with pixel-art ships, nine playable species and an empire picker

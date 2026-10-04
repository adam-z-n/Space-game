# Changelog

## 1.1.0 (in progress)

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

## 1.0.0

The first complete version: Milestones 1 to 6 and the classic space opera theme.

- Seeded galaxies in three sizes, fog of war, fleet orders with route previews, undo and autosave
- Colonies, four resources, build queues and a research tree
- Ship design, fleets, supply, blockades, interception and auto-resolved battles with replays
- AI opponents with five personalities, three difficulty levels and domination, elimination or turn-limit victory
- Colony defenses, invasions, minefields and support ships
- Classic retro look with pixel-art ships, nine playable species and an empire picker

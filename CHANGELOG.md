# Changelog

## 1.3.0 (in progress)

Invasions:

- Troop ships land only as many troops as a safe win needs: the biggest transports go first until they reach 125%
  of the defenders (a 99.9% win), and the rest stay in orbit for the next target. Transports from several fleets
  ordered against the same colony land together.
- If the troops on hand fall short, they wait in orbit for reinforcements (the turn report and fleet sheet say how
  many more are needed), or you can order an all-out landing that commits every transport now, to wear down the
  garrison even if it fails.
- Fixed: transports, supply ships and other unarmed fleets fled from any battle in their system, dropping their
  invasion orders, even while your warships were winning it. They now hold position behind your warships, and
  withdraw only if those withdraw or are destroyed.

Building:

- Queue ships in batches of 1, 3 or 5 from a colony's build list. A batch is one queue entry ("Troop Ship ×5")
  that builds its ships one after another; each ship still becomes its own fleet.

Screens:

- New Planets screen (menu): every colony's food, industry, research and credits per turn, with the workers on each
  job. Tap a heading to sort; tap a planet to move its workers or hand them back to its focus.
- Resupply points now show on the map whenever one of your fleets is selected, instead of through a menu toggle.
- The menu no longer has a Research tree entry; open it from the research screen.

AI:

- AI empires now use the 1.1 tools. Strike forces bring siege ships (bomb bays, once researched) that bombard
  a colony whose defenses are down until the troops in orbit can take it, then stop. Cloaked commando ships go
  ahead to knock out a target's defenses, then thin its garrison. A combat outpost near the front becomes a
  supply depot. Without bombers, a close-run landing goes in all-out instead of waiting.
- AI troop ships follow the new invasion rule and are built in batches.
- Coalition (Domination and Total domination games only): from turn 175, once the human players hold half the
  galaxy's population, every AI empire turns on them, the strongest human first, until they fall below 40%.
  The turn report says when it forms or breaks up, and the Empire screen shows the rule.

Galaxy types (new game setup):

- Standard (as before), Sparse (55% of systems without planets), Dense (10%), Clusters (groups of about six
  tightly linked stars, joined by a lane or two), Spiral (two arms around a core) and Ring (a ring of stars
  around an empty middle).

## 1.2.0 (unreleased)

Victory conditions:

- Choose how to win at setup: 200 turns (as before), 400 turns, Domination (no turn limit; hold 75% of the
  galaxy's population) or Total domination (no turn limit; hold all of it). Outlasting every rival always wins.
  Saves from earlier versions play as 200-turn games.
- AI empires now count planetary defenses, not just fleets: a rival's colony defenses when sizing up an attack,
  and their own when deciding whether an intruder is a real threat.
- Endgame drive, in games with no turn limit: an AI holding over half the galaxy's population after turn 250 goes on
  the offensive; after turn 300, if the human players hold under 20% between them, every AI does; after turn 350,
  every AI does regardless. Driving AIs attack whatever their temperament, raiders mass into full fleets and
  invade, and banked credits go into warships, up to three times the strongest rival's known strength.
- AI empires keep at most 60 warships, so late games stay quick to play; past that their strength comes from
  better designs. AI strikes now launch as full fleets rather than streams of single ships.
- AI attack fixes (all modes): a strike force launched toward a target more than a turn away was called back to its
  staging system every turn and never arrived; and troop transports that had plotted a retreat after a skirmish at
  staging were never loaded, so the strike force couldn't invade. AI empires now capture about twice as many
  colonies per game.

Logistics, experience and command:

- Fleets resupply only at your colonies (unless blockaded) and supply depots. Every turn away costs a turn of
  supply; endurance rises to 10-16 turns by hull. Repairs also happen only there, or from supply ships.
- Supply ships (Supply Hold, from Extended Tanks) carry stores that keep their fleet supplied in the field:
  one ship-turn per ship each turn until the stores run out. They also reload spent missile launchers (one ship-turn
  per ship rearmed) and, with Field Repair, mend 15% of every ship's hull a turn and fix one knocked-out part per
  ship. They refill at colonies and depots. Supply ships replace repair tenders: the Repair Bay and the Repair
  Tender design are gone, and tenders in older saves become supply ships.
- Ships gain experience from battles they survive, more for kills and for fighting outnumbered, and rank up from
  Green to Regular, Veteran, Elite and Ace. Each rank adds accuracy and evasion: +1% on escorts and freighters up
  to +5% on dreadnoughts. A Military Academy trains new ships as Regulars.
- Fleet Command Network (Fleet Command tech, battleships and larger): while the command ship lives, its whole
  fleet gets +10% accuracy, +5% evasion and +1 maneuver.
- The map shows resupply points instead of a supply range; the fleet sheet shows supply, stores and each ship's rank.
- The AI plans its trips home to resupply, sends supply ships with its strike forces and uses command networks.

Research tree:

- The tree grows from 56 to 118 techs. Each of the eight fields (now Biology, Construction, Computers, Propulsion,
  Electronics, Logistics & Trade, Weapons, Defense) has core techs everyone can research and three rival schools
  of three techs each.
- Terrans, Psyrrh and Mekkan can research every school. The other six races follow one school per field: their
  first tech in a school commits them to it and closes its rivals. Each has an affinity field where research is
  faster (20–50% by race) and they may follow two schools (Saurak: Logistics & Trade, Kraal: Construction, Aviari: Propulsion, Lithari:
  Logistics, Felari: Weapons, Ursoni: Defense). All but the Saurak may also follow two schools in a second field
  (Kraal: Logistics & Trade, Aviari: Electronics, Lithari: Construction, Felari: Propulsion, Ursoni: Weapons).
  Every race can reach at least 60% of the tree.
- Kraal also build ships 10% cheaper; Aviari gain +5% ship evasion and +15% credits; the Lithari growth penalty eases
  from -30% to -15%.
- Capturing a colony has a 25% chance to capture the cheapest tech its owner knew that you don't, even one from a
  school you are locked out of (Data Theft raises the odds).
- New techs and parts include Miniaturization (+1 slot on every hull), Reinforced Frames, Damage Control, Flight
  Operations, Expert Systems and Sentient Computers, Tactical Datalinks and Battle Coordination AI, Hit-and-Run,
  Solar Sails, Tractor Beams, Stealth Hulls, Tachyon Scanners, Galactic Survey, Sensor Spoofing, Gas Giant
  Harvesting, Corporate Charters, Particle Beams and Phase Cannons, Swarm Missiles, the Spinal Mass Driver,
  Reactive Armor, Planetary Shields, Star Fortresses and the Megafactory.
- The research tree screen groups each field into core techs and schools, shows which schools you follow and which
  are closed, and the empire picker shows each race's research access.

Combat:

- Missile ammunition: missile launchers carry a few salvos (Nuclear Missiles, Hellfire and Swarm 3, Starburst 2)
  and rearm only at your colonies and depots. Beams never run dry.
- Battle damage: a heavy hit can knock out one of a ship's weapons, shields, engines or electronics (chance is the
  damage as a share of its hull, up to 40%). Knocked-out parts stay out until repaired at a colony or depot;
  supply ships (with Field Repair) and Damage Control fix one per ship per turn in the field.
- Pursuit: a fleet that withdraws takes a parting volley from enemy ships more maneuverable than its slowest ship.
  Hit-and-Run Doctrine avoids it; Tractor Beams let every one of your ships take the shot.
- Fleet size: fleets of more than 8 warships (14 with a command network) lose 3% accuracy and evasion per extra
  warship, up to 24%. Only armed ships count: supply ships, troop transports and other support ships ride along
  free. The AI keeps its fleets within the limit.
- Battle replays show parting shots and knocked-out parts; the fleet sheet shows the size limit, damaged parts and
  missile salvos left.

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

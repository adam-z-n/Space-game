# Roadmap

Ideas for future versions, roughly grouped. Version 1.3 (released with 1.1 and 1.2) covers, among much else,
logistics, ship experience, a larger research tree with race-specific schools, invasion handling, build batches, a
planets screen, galaxy types, research pacing, and AI siege tactics and coalition. Version 1.4 added combat rules
(retreat the way you came, no holding orbit under colony guns), colony destruction and bioweapons, gas giant
habitats, warp gates, nine new weapons and in-game help; the rest waits here.

## Version 1.5 (agreed, next)

- **Fleet command overhaul.** Ships act on their own unless formed into a fleet, which needs an officer and a
  designated flagship; if the flagship dies the fleet breaks up (retreating in battle). Only ships assigned to a
  naval command may attack (enter systems with known enemy fleets or colonies, invade, bombard, sabotage).
  Empires start with one command and gain one per 5 colonies; each command holds a number of points (escort 1,
  frigate 2, freighter 1, cruiser 4, battleship 8, dreadnought 12), starting at 12 and growing with population and
  two techs. Fleets can't change course in transit until a Subspace Command tech. Answered: a fleet stopped away from a
  colony or outpost takes new orders only with Subspace Command; support ships cost 1 point each. Later requests: officers per
  command, flagship targeting, officer experience, cohesion, Chain of Command, command home systems, and outpost
  marks unlocked by weapons research. Approved design: `docs/FLEET_COMMAND.md`.

## Future versions (requested)

- **Diplomacy:** relations with each AI empire, treaties (non-aggression, alliance, open borders), and AI
  attitudes driven by personality and history. Today every empire is hostile to every other.
- **Espionage and sabotage:** build on 1.1's commando teams and cloaking with spies that steal techs, reveal
  rival fleets, colonies and designs, incite unrest, or sabotage production. The AI should also use them.
- **Trade:** trade agreements and routes between empires and between your own colonies, with income that
  blockades and war can cut.
- **Pass-and-play multiplayer:** several people take turns on one device, with a handover screen between
  turns so nobody sees another player's view. The simulation is already deterministic and command-based,
  which also prepares for online multiplayer later.

## Combat ideas for later

- **Battlefield terrain:** nebulae weaken sensors and shields, asteroid fields add evasion and hurt missiles,
  blue giants drain shields, so where you fight matters.
- **Ambush:** a fleet holding position on evade orders (or cloaked) gets a free first round on arrivals.
- **Admirals:** commanders earned from victories, with traits, assigned to fleets; they can be killed.
- **Boarding:** troop pods capture crippled enemy ships, with a chance to reverse-engineer a component.

## Other candidates noted along the way

- AI tuning: the warlord and turtle personalities rarely win; expansionists win most. 1.5's command rules halved
  conquest in all-AI games and hit raiders and warlords hardest; ideas: strikes launched from several commands at
  once, using spare officers for second fleets, and longer campaigns (pushing on to the next target).
- Teach the AI the remaining 1.1 tools: minelayers and cloaked raiding (1.3 taught it bombardment, commando raids
  and supply depots).
- AI debt in collapsing empires: an empire losing colonies to conquest keeps its fleet and runs deep into debt
  (seen in long Total domination games); it should scrap ships faster as its income shrinks.
- Weapon ideas not taken up in 1.4: Siphon Beam (damage recharges the firer's shields), Decoy Drones (draw fire
  away from the carrier).
- AI use of the 1.4 weapons beyond picking its best gun: graviton lances to stop retreats, EMP and ion cannons in
  mixed designs, hunter-killer satellites at border colonies, planet crackers.
- Fleet command ideas not taken up in 1.5: escape pods (officer survives losing the flagship half the time),
  command relays (a depot upgrade that counts as a command post), doctrines per command (Assault, Defensive, Rapid,
  Siege), officer traits (the full Admirals idea), patrol orders for groups, officer upkeep, battle honors.
- Mothballing fleets: lower upkeep while docked, slow to reactivate.
- Mobile app builds (Capacitor for iOS and Android), performance, and polish.
- Update the GitHub Actions workflows to action versions that run on Node.js 24 (checkout, setup-node,
  configure-pages, upload-pages-artifact, upload-artifact): GitHub warns that their current versions target the
  deprecated Node.js 20.
- The app checking for a new version itself, so phones don't keep showing an old copy.

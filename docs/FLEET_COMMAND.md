# 1.5 Fleet command overhaul: design proposal

Status: approved (revision 3 with the softer mark steps); being built. Builds on the agreed draft in `docs/ROADMAP.md`
and the owner's answers and requests:
- A fleet stopped away from a colony or outpost takes new orders only with Subspace Command.
- Support ships cost 1 command point each.
- Two techs each add an officer (a fleet) to every naval command.
- A midgame tech allows targeting flagships.
- Ships not in a fleet can always move between your own colonies and outposts.
- Officer experience, cohesion, Chain of Command and flagship screening.
- Each naval command is based at a system, and fleets form only there.
- Outpost and depot upgrades that unlock with weapons research.

## 1. The idea in one paragraph

Ships move about freely in loose **groups**, but a group can't start a fight. To attack you form a **fleet** at
the home system of one of your **naval commands**. One of that command's **officers** takes charge, you name a
**flagship**, and the fleet's ships come out of the command's pool of points. Only fleets enter systems with known
enemy ships or colonies, invade, bomb or sabotage. A fleet commits to its course: once it leaves, it can't be turned
around in flight, and once it stops away from your colonies and outposts it can only be sent back to one (both
lifted by the Subspace Command tech). If the flagship is destroyed the officer dies with it, the fleet breaks up and
withdraws, and that officer's place stays empty for a few turns. A new fleet also needs a few turns of drill
(cohesion) before it fights at its best, and officers who survive battles get better.

## 2. Groups and fleets

| | Group (no command) | Fleet (formed, in a command) |
|---|---|---|
| Move to your own colonies and outposts | Always, even when enemies are there | Yes |
| Enter other systems with known enemy ships or colonies | No (armed groups) | Yes |
| Invade, bomb, sabotage | No | Yes |
| Fight when attacked | Yes | Yes |
| Change course in flight | Yes | Only with Subspace Command |
| New orders when stopped away from your colonies and outposts | Yes | Only "return to a colony or outpost", unless you have Subspace Command |
| Size | No cap; more than 8 warships fight worse (today's oversize penalty) | Capped by its command's points; no oversize penalty |
| Command Network, officer rank, cohesion | No | Yes |

- **Unarmed groups go anywhere.** Scouts, colony ships, outpost ships and supply ships aren't attacking, so they
  ignore the "enter" rule. Troop ships, bombers and commandos can travel unformed, but they need a fleet to invade,
  bomb or sabotage.
- **Infiltrators are the exception** (owner's request, after part 1). A group made only of cloaked escorts or
  destroyers (hulls marked `infiltrator` in the content), carrying commandos, may enter enemy systems and sabotage
  without a fleet, armed or not. Cloaked commandos on cruisers or larger, or a group with any uncloaked ship, don't
  qualify. Infiltrators still can't invade or bomb. Sneaky sabotage stays a tactic of its own.
- **Known** means what your empire knows: sightings and charted colonies, the same knowledge the AI uses. If an
  armed group's next stop turns hostile while it travels, and isn't one of your colonies or outposts, the group
  halts where it is and you get a "group halted" event.
- **Home ground.** The route to your own colony or outpost avoids systems with known enemies when it can. When there
  is no other way, a group may pass through one, but it can't stop there.

## 3. Naval commands: home systems, points and officers

### Home systems

- **First command**: based at your capital from the start. Your two starting destroyers begin as its first fleet.
- **New commands**: when you can support another (one per 5 colonies), you are asked to pick its home system.
  - The home must be a system with one of your colonies, and each system holds at most one command.
  - The command is ready 3 turns after you place it.
  - Until you choose, the extra command just waits; nothing is lost.
- **Forming fleets**: only at a command's home system, and the new fleet belongs to that command. So where you base
  commands decides where your strikes start from.
- **Losing the home** (your last colony in that system is captured or destroyed):
  - **Still supported** (you have enough colonies for all your commands): the command is **displaced**. You are asked
    to move it to another of your colony systems, and it is ready again 5 turns after you choose. Its fleets keep
    their officers and carry on meanwhile, but none can form for it.
  - **No longer supported**: the command is lost, and its fleets become groups at once. They can still go home,
    since groups can always move to your own colonies.
- **Fewer colonies without losing a home**: you keep every command you have. You just can't add one until you are
  back over the number again.
- **Capital moves**: the command based there stays where it is.

### Points and officers

| Rule | Number |
|---|---|
| Commands at start | 1, at your capital |
| Extra commands | +1 per 5 colonies (5 colonies: 2, 10: 3, 15: 4...), each placed at a colony system you pick |
| Points per command at start | 12, shared by all its fleets |
| Growth with population | +1 point per command for every 10 population in the empire |
| Naval Staff College (new tech) | +4 points per command |
| Fleet Admiralty (new tech) | +8 points per command |
| Fleet Command Network on a flagship | +6 points to its command while that fleet exists (replaces today's "+6 ships" size bonus) |
| Officers per command at start | 1 (so one fleet per command) |
| Officer Academy (new tech) | +1 officer per command |
| Combined Fleet Doctrine (new tech) | +1 officer per command (3 in all) |

**Points and officers work together.**
- Points set how many ships a command can field in all.
- Officers set how many separate fleets it can split them into. Extra officers don't add strength; they let you run
  several operations at once, such as a main strike, a raid and an escort for an invasion, from the same points.

Points per ship:

| Ship | Points |
|---|---|
| Escort | 1 |
| Destroyer | 2 |
| Cruiser | 4 |
| Battleship | 8 |
| Dreadnought | 12 |
| Any unarmed ship (freighter, troop, supply, scout...) | 1 |

A ship counts as armed by design, the same test the fleet size limit uses today, so a ship whose guns are knocked
out still costs its hull's points.

**Example.** At the start you have 1 command of 12 points at your capital, with 1 officer: one fleet of 6
destroyers, or 2 cruisers, a destroyer and 2 troop ships. After Officer Academy the same 12 points can be two fleets,
say 8 points striking while 4 escort a troop convoy.

A mid-game empire with 12 colonies, 60 population, Staff College and Officer Academy has:
- 3 commands (the capital and two colonies you picked), each with 12 + 6 + 4 = 22 points and 2 officers.
- Up to 6 fleets and 66 points in all.

**What AI games look like today** (probe: 8 small and 4 medium all-AI games, normal difficulty, median and best
empire alive at each turn):

| Turn | Colonies (median / max) | Population | Warships | Warship points (draft weights) | Biggest fleet, points |
|---|---|---|---|---|---|
| 50 | 5-7 / 12 | 22-35 / 59 | 2-3 / 8 | 4-5 / 16 | 4 / 9 |
| 100 | 5-12 / 20 | 26-60 / 126 | 2-4 / 17 | 4-10 / 34 | 4-8 / 17 |
| 150 | 6-11 / 23 | 30-76 / 138 | 3-4 / 49 | 9-16 / 102 | 6-8 / 26 |
| 200 | 5-9 / 29 | 34-79 / 163 | 3-4 / 48 | 12-17 / 55 | 8-9 / 29 |

So 12 points rarely pinches the AI before turn 100. Later the leaders' strike fleets (26-29 points) will need the
techs, a Command Network flagship or a second command. The rules mostly bite through the size of each command, where
fleets can form, and committing to a course: you can still build a large navy, but you have to plan how you use it.

**When limits drop** (population lost, or a Command Network flagship gone): formed fleets are never broken up by
force. You just can't form new fleets in that command or add ships until it is back under its points.

## 4. Forming, changing and dissolving

- **Form fleet**: at a command's home system, with a free officer and enough free points in that command. Pick the
  flagship. It must be an armed ship, and the strongest one is suggested. The fleet gets an officer with a
  generated name. It starts at 50% cohesion (section 6).
- **Add ships**: merge a group into a fleet anywhere both are stopped in the same system, if its command's points fit.
  Each ship added lowers cohesion by 10% (to no less than 50%). Reinforcements can join in the field, at a cost.
- **Detach ships**: anywhere. Detached ships become a group.
- **Change flagship**: at a colony, outpost or depot, or anywhere with Subspace Command. Cohesion drops by 20%.
- **Dissolve**: anywhere. The ships become a group, and the officer (with their experience) and the points are free
  again at once. A group can't attack, so dissolving away from home doesn't get around the course rules: to attack
  again the ships must go back to a command's home and form again.

## 5. Orders and movement for fleets

Without Subspace Command:

- **In flight**: a fleet can't take a new course or halt. It flies to the destination you gave it. Automatic
  retreats after a lost battle still happen, as today (back the way it came).
- **At a colony, outpost or depot of yours** (a "command post"): it takes any order.
- **Stopped anywhere else**: it can be ordered only to a command post (any of yours it can reach). It can still
  hold, change stance, retreat threshold and target priority, invade, bomb or sabotage the system it is in, and take
  ships in or detach them.
- So a strike has to be planned: pick the target, go, fight, then come home, or push on only if you planned the
  route through. Routes with several stops are allowed, so "via A to B" works.

**Subspace Command** (new tech) lifts both limits: change course in flight, and full orders anywhere. Fleets still
form only at command homes.

## 6. Officers, flagships and cohesion

**Officer experience.**

| Rank | Experience | Fleet bonus |
|---|---|---|
| Officer | 0 | none |
| Veteran | 6 | +3% accuracy and evasion |
| Seasoned | 15 | +6% |
| Legendary | 30 | +9% |

- An officer gets 2 experience per battle fought and 2 more for a win.
- An officer whose fleet is dissolved goes back to the command's pool with their rank. The next fleet formed there
  gets the most experienced free officer. So Officer Academy also lets you keep veterans in reserve.

**Cohesion.**
- A new fleet starts at 50% cohesion and gains 10% a turn, up to 100%.
- Each ship merged in costs 10% (minimum 50%), and changing flagship costs 20%.
- Below 100% the fleet loses accuracy: at 50% it is 10% less accurate, scaling down to no loss at 100%.
- It rewards keeping fleets together and forming them before you need them, not merging everything at the last
  moment.

**Flagship destroyed.**
- The officer dies with it. At the end of that round the fleet breaks up.
- Its surviving ships withdraw from the battle as a beaten fleet does today: parting shots and pursuit as usual, and
  graviton-pinned ships can't leave. After the battle they are a group, back where they came from.
- A flagship that dies outside battle (attrition, bombs, nanites after battle) has the same effect, minus the
  withdrawal.
- A new officer arrives in **5 turns**. Until then that command has one officer fewer.
- **Chain of Command** (new late tech): the officer is still lost, but the fleet holds together. The toughest ship
  left becomes flagship and cohesion falls to 50%. The fleet fights on under its usual retreat rules.

**Flagship targeting** (from the midgame tech Command Ship Analysis): a new target priority, **Flagship**.
- Every shot that can reach the enemy flagship goes for it. That breaks enemy fleets apart, at the cost of ignoring
  the escorts.
- Range rules still apply. Groups (no flagship) are targeted as with Warships.
- Without the tech, the option is hidden.

**Flagship screening** (the counter).
- Ships in the Screen formation guard their flagship: a flagship-targeted shot has a 30% chance to hit a screening
  ship instead.
- With Holographic Decoys (existing tech), enemies firing at your flagship pick the wrong ship 50% of the time.

**Command Network**: its bonuses (accuracy, evasion, +1 maneuver, the datalink techs) now need the fleet to be
formed. If the network ship is the flagship, its command also gets +6 points.

## 7. Outpost and depot upgrades

Combat outposts and supply depots can be upgraded step by step, from Mark I to Mark V. Each mark unlocks with
weapons research after Outpost Construction.

| Mark | Unlocks at (weapons techs known) | Cost (credits) | Hit points | Guns | Upkeep |
|---|---|---|---|---|---|
| Base | Outpost Construction | an outpost ship | 60 | 2 x 5 damage, 70% accuracy | 1 |
| I | 3 | 150 | 100 | 3 x 6, 70% | 1 |
| II | 5 | 250 | 150 | 3 x 8, 72% | 2 |
| III | 8 | 400 | 220 | 4 x 9, 75% | 2 |
| IV | 11 | 600 | 300 | 4 x 11, 75% | 3 |
| V | 13 | 850 | 400 | 5 x 12, 78% | 3 |

For comparison, an Orbital Fortress is 120 hit points with 3 x 8 guns for 120 credits, and a Star Fortress is 300
hit points with 4 x 12 guns for 260. A Mark V outpost is a fortress in deep space, at more than three times the
price.

- **Weapons techs** are those in the Weapons field (23 in the tree). They are counted whenever you got them, since
  Outpost Construction is cheap and early, so the steps (3, 5, 8, 11, 13) are about "every 3 new weapons techs" in practice.
- **One mark at a time.** It is bought with credits and done at once, like a depot upgrade. A depot keeps its mark
  when built, and an outpost keeps its mark when made into a depot.
- **A destroyed outpost is gone**, as now. A damaged one repairs at its usual rate up to its mark's hit points.
- **The empire's colony defense bonuses** (the effects that add defense hit points and damage) apply on top, as they
  do for colony defenses today.
- **Clear path needed.** To upgrade, there must be a route along lanes from the outpost to one of your colonies on
  which no system, the two ends included, holds a known enemy fleet, outpost or colony. An outpost cut off or under
  siege can't be upgraded until the way is clear. The outpost sheet shows the reason, such as "cut off: enemy fleet
  at Vega".

## 8. New techs

| Tech | Field | Needs | Cost (approx.) | Effect |
|---|---|---|---|---|
| Naval Staff College | Logistics | Supply Lines | 400 | +4 points per command |
| Officer Academy | Science | Battle Computers | 450 | +1 officer per command |
| Command Ship Analysis | Sensors | Electronic Warfare | 700 | Unlocks the Flagship target priority |
| Subspace Command | Sensors | Deep Space Arrays | 900 | Fleets change course in flight and take any order anywhere |
| Fleet Admiralty | Science | Naval Staff College, Battleship Hulls | 1300 | +8 points per command |
| Combined Fleet Doctrine | Science | Officer Academy, Battleship Hulls | 1600 | +1 officer per command |
| Chain of Command | Science | Combined Fleet Doctrine | 2000 | A fleet that loses its flagship holds together |

Final costs follow the depth scaling 1.3 introduced. All seven are core techs, open to every race. None of them
needs a school tech, so a race that follows one science school isn't pushed into Command & Control to get them (see
section 13).
Outpost marks need no new techs.

## 9. Saves and the AI

**Saves (state version 18).** Loading a 1.4 game:
- Every empire's first command is placed at its capital. Any extra commands it can support are placed at its largest
  other colonies, so nobody is asked to choose on load.
- Each empire's armed fleets are formed, strongest first, as long as it has officers free.
  - The flagship is the toughest armed ship.
  - The fleet keeps all its ships, even if that is over the point limit.
  - Cohesion starts full.
- Other fleets become groups.
- Officers are named with the seeded random generator, so replays still match.
- Outposts and depots start at the base mark.

**AI.**
- **Command homes**: it places each new command at a colony with a shipyard on the side facing its war target, or
  next to its capital if it is at peace. It moves a displaced command to its nearest safe colony.
- **Strike forces**:
  - It gathers warships at the home of the command nearest the target, forms fleets there within that command's
    points (using a Command Network ship as the flagship when it has one), and lets cohesion build.
  - It launches when the fleets are strong enough and cohesion is at least 80%, or at once if a target is about to
    get away. If the fleets aren't strong enough, it picks a weaker target or waits.
- **Invade, siege and commando raids** go only through formed fleets. With spare officers it splits off a raid or
  an invasion escort.
- **Defense**: groups defend colony and outpost systems. Threats elsewhere in its space need a free fleet.
- **Movement**:
  - It never retargets a fleet in flight without the tech.
  - Fleets stranded away from home go to the nearest command post.
  - After a won battle a fleet stays to invade, bomb or siege, and goes home when that is done.
- **Breakups**: survivors regroup at the nearest command home.
- **Targeting and screening**: it uses Flagship targeting when its fleet outguns the enemy's escorts, and designs a
  screening ship or two into fleets once rivals have Command Ship Analysis.
- **Outposts**: it upgrades border outposts and depots when it has credits to spare, the path is clear, and the
  outpost faces a rival.
- **Research**: values Staff College, Officer Academy and Subspace Command, then Admiralty, Combined Fleet Doctrine,
  Command Ship Analysis and Chain of Command, more for warlike personalities.
- **What stays the same**: the warship cap of 60 and the build rules. Sims will show whether the AI needs to build
  differently.

The AI never sees hidden state: it uses its own command limits and the enemy fleets, outposts and colonies it knows
about, as now.

## 10. Screens

- **Placing commands**:
  - When a new command is available, or one is displaced, an event and a banner say so.
  - Tapping it opens the map with the systems you can choose highlighted.
  - Command homes have a mark on the map.
- **Fleet sheet**:
  - Shows "Fleet: Veteran Name, flagship X, 2nd Command, cohesion 70%" or "Group: can't attack".
  - New buttons: Form fleet (choose flagship), Dissolve, Set flagship.
  - Says why a move isn't allowed: "needs a fleet to enter enemy space", "committed to its course", "can only return
    to a colony or outpost", "fleets form at a command's home".
- **Map**:
  - Destinations a selection can't go to are greyed out when you pick a move.
  - Fleets carry a flag mark that groups don't.
- **Fleets screen**: one line per command, such as "2nd Command at Vega: 2 of 2 officers, 18 of 22 points, next
  officer in 3 turns".
- **Outpost sheet**: its mark, the next mark's cost and stats, and the upgrade button, or why it is unavailable.
- **How to play** and first-game tips: a short section on fleets, commands and outpost marks.

## 11. Build plan

Each part is committed and pushed, with tests. One PR for 1.5 at the end.

1. **Core rules**:
   - State: commands (home, officers, displaced or pending timers) on the empire, and `fleet.command` (command,
     officer, flagship, cohesion).
   - Content: hull `commandPoints`, a `combat.command` block, the seven techs and their effect keys, and the
     outpost marks.
   - Commands: `placeCommand`, `formFleet`, `dissolveFleet`, `setFlagship` and `upgradeOutpost` (now with marks),
     plus the movement and attack checks.
   - Save migration to version 18, with tests.
2. **Combat**:
   - Flagship loss, breakup and withdrawal; Chain of Command; officer replacement and experience; cohesion.
   - Flagship targeting and screening, the network bonus only for formed fleets, and the size penalty only for
     groups.
   - Outpost marks in battle.
   - Tests.
3. **AI**: as in section 9. Full AI-game tests, and no rejected AI commands in the sims.
4. **Screens** and the How to play section. Screenshots checked on an iPhone 13 size.
5. **Balance**:
   - Before/after sims with the same seeds: 60 small games, plus medium games.
   - Reported by personality and race: win rates, game length, battles, invasions, ships lost, outpost marks bought.
   - Then the changelog and roadmap.

## 12. Defaults I picked (say if you disagree)

1. Unarmed groups (scouts, colony ships and the like) go anywhere. Only armed groups are barred from enemy systems.
2. Groups pass through a hostile system only when there is no other route to your own colony or outpost, and can't
   stop there.
3. A fleet stopped away from home without Subspace Command may still be ordered back to a command post. Otherwise it
   would be stuck forever.
4. Losing the flagship kills the officer, and that place stays empty for 5 turns.
5. Population growth: +1 point per command per 10 population.
6. Fleets over their limits are never broken up by force. The exception is a lost command its empire can't support,
   whose fleets become groups.
7. Command Network flagship: +6 points.
8. Points are shared within a command rather than set per fleet, so extra officers add flexibility, not strength.
9. Command homes: colony systems only, one command per system. A new command is ready in 3 turns, a moved one in 5.
10. Outpost marks: unlocked at 3, 5, 8, 11 and 13 weapons techs, counted whenever you got them; bought at once with credits.
11. Clear path: no known enemy fleet, outpost or colony anywhere on the route, the outpost's own system included.

## 13. Race impact (predicted from the values, no games played)

**How the races differ in research.**
- **Full access:** Terrans, Mekkan and Psyrrh can research every school.
- **Limited access:** the other six follow one school per field, or two in their affinity field and one other.

**Effects that touch the new rules.**

| New rule | Who it helps | Who it hurts |
|---|---|---|
| Commands per 5 colonies | Wide empires: Lithari (settle hostile worlds), Saurak | - |
| Points per 10 population | Saurak (+50% growth) | Psyrrh and Lithari (-15% growth): about 1 point per command less in the midgame |
| Points per hull, whatever the ship costs | Quality: Felari (+15% damage), Aviari (+5% evasion) | Quantity: Kraal (-10% ship cost, +30% industry), whose edge in numbers is capped in attack; groups at home stay uncapped |
| Troop ships cost points | Ursoni (+60% troops): an invasion needs about 40% fewer transports, freeing 2-4 points | - |
| Committed course | Aviari (+30 speed): strike and return to re-order sooner | Slow empires a little |
| Outpost marks cost credits | Terrans (+25%), Aviari (+15%) | - |
| Outpost marks use colony defense bonuses | Mekkan (+25% defenses), full-access races (all defense schools) | - |
| Outpost marks need weapons techs | Felari (+40% weapons research, 2 schools), full-access races (23 reachable) | One-school races: 17 reachable, so Mark V needs 15 of their 17 (88%) against 15 of 23 (65%) |
| Flagship screening with Holographic Decoys | Full-access races, Aviari (two sensors schools) | Races that pick another sensors school |

**Race by race.**

| Race | Prediction | Why |
|---|---|---|
| Terrans | Small gain | Credits pay for outpost marks; all techs. |
| Mekkan | Gain, the one to watch | +25% defenses on outposts. With every defense tech, a Mark V outpost reaches about 800 hit points and 5 x 24 guns. Defense gets stronger while attack gets harder. |
| Psyrrh | Gain | +40% research reaches the seven new techs and the outpost marks first. Slower growth costs about a point per command. |
| Felari | Gain | +15% damage gives more strength per point, and the weapons affinity unlocks marks fastest. |
| Aviari | Gain | Fast, evasive escorts are the most efficient use of points (2 slots per point, high evasion). Speed softens the course rules. Credits pay for marks. |
| Ursoni | Small gain | Fewer troop ships per invasion. Their defense affinity helps outposts. |
| Saurak | Small gain | Growth means more points. Neutral elsewhere. |
| Lithari | About even | More colonies, so more commands, but slower growth means fewer points. One weapons school slows marks. |
| Kraal | Loss | Their strength is more ships; points cap each strike, and the -10% cost does nothing against the cap. Still strong defending at home. |

**What I changed and suggest.**
1. **Fixed in this revision:** Fleet Admiralty, Combined Fleet Doctrine and Chain of Command first needed Fleet
   Command, which is in the Command & Control school. The six limited races would have had to pick that school over
   AI or Cyber Warfare to get 3 of the 7 techs. They now need core techs only (section 8).
2. **Adopted:** marks unlock at 3, 5, 8, 11 and 13 weapons techs instead of 3, 6, 9, 12 and 15. A one-school race
   then needs 13 of 17 (76%) for Mark V, against 57% for full access. The gap shrinks but doesn't close; it can't
   while the counting is by tech.
3. **Watch in the sims:** Mekkan outposts, Aviari escort swarms and Kraal strikes. If Kraal fall behind, one option
   is a race trait such as "Hive coordination: +2 points per command". I'd only add it if the sims show it is needed.

# 1.5 Fleet command overhaul: design proposal

Status: proposal, waiting for the owner's approval. Builds on the agreed draft in `docs/ROADMAP.md` and the owner's
answers: a fleet stopped away from a colony or outpost takes new orders only with Subspace Command; support ships
cost 1 command point each.

## 1. The idea in one paragraph

Ships move about freely in loose **groups**, but a group can't start a fight. To attack you form a **fleet**:
assign one of your naval commands to it, which brings an **officer**, and name a **flagship**. Only fleets enter
systems with known enemy ships or colonies, invade, bomb or sabotage. A fleet commits to its course: once it
leaves, it can't be turned around in flight, and once it stops away from your colonies and outposts it can only be
sent back to one (both lifted by the Subspace Command tech). If the flagship is destroyed the officer dies with it,
the fleet breaks up and withdraws, and that command stays empty for a few turns.

## 2. Groups and fleets

| | Group (no command) | Fleet (formed, has a command) |
|---|---|---|
| Move within your space | Yes | Yes |
| Enter a system with known enemy ships or colonies | Only if one of your colonies or outposts is there (defense) | Yes |
| Invade, bomb, sabotage | No | Yes |
| Fight when attacked | Yes | Yes |
| Change course in flight | Yes | Only with Subspace Command |
| New orders when stopped away from your colonies and outposts | Yes | Only "return to a colony or outpost", unless you have Subspace Command |
| Size | No cap; more than 8 warships fight worse (today's oversize penalty) | Capped by command points; no oversize penalty |
| Command Network bonus | No | Yes (as today) |

- **Unarmed groups go anywhere.** Scouts, colony ships, outpost ships and supply ships aren't attacking, so they
  ignore the "enter" rule. Troop ships, bombers and commandos can travel unformed, but they need a fleet to invade,
  bomb or sabotage.
- **Known** means what your empire knows: sightings and charted colonies, the same knowledge the AI uses. If an
  armed group's next stop turns hostile while it travels, it halts where it is and you get a "group halted" event.
  It never blunders into a fight.
- **Defense exception.** A group may enter a system that holds one of your colonies or outposts even when enemies
  are there, so you can always defend your own worlds without a command.

## 3. Naval commands and points

| Rule | Number |
|---|---|
| Commands at start | 1 |
| Extra commands | +1 per 5 colonies (5 colonies: 2, 10: 3, 15: 4...) |
| Points per command at start | 12 |
| Growth with population | +1 point per command for every 10 population in the empire |
| Naval Staff College (new tech) | +4 points per command |
| Fleet Admiralty (new tech) | +8 points per command |
| Fleet Command Network on the flagship | +6 points for that fleet (replaces today's "+6 ships" size bonus) |

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

**Example.** At the start you have 1 command of 12 points: 6 destroyers, or 2 cruisers, 1 destroyer and 2 troop
ships. A mid-game empire with 12 colonies and 60 population and Staff College has 3 commands of 12 + 6 + 4 = 22
points: a battleship, two cruisers, a destroyer and 4 support ships each.

**What AI games look like today** (probe: 8 small and 4 medium all-AI games, normal difficulty, median and best
empire alive at each turn):

| Turn | Colonies (median / max) | Population | Warships | Warship points (draft weights) | Biggest fleet, points |
|---|---|---|---|---|---|
| 50 | 5-7 / 12 | 22-35 / 59 | 2-3 / 8 | 4-5 / 16 | 4 / 9 |
| 100 | 5-12 / 20 | 26-60 / 126 | 2-4 / 17 | 4-10 / 34 | 4-8 / 17 |
| 150 | 6-11 / 23 | 30-76 / 138 | 3-4 / 49 | 9-16 / 102 | 6-8 / 26 |
| 200 | 5-9 / 29 | 34-79 / 163 | 3-4 / 48 | 12-17 / 55 | 8-9 / 29 |

So 12 points rarely pinches the AI before turn 100. Later the leaders' strike fleets (26-29 points) will need
the techs, a Command Network flagship or a second fleet. The total across all commands almost never binds: the
rules bite through the size of each fleet, the command count early on, and committing to a course. That is the
intent: you can still build a large navy, but you have to plan how you use it.

**When limits drop** (colonies or population lost): formed fleets are never broken up by force. You just can't form
new fleets or add ships until you are back under the limits. Saves from 1.4 load the same way (see section 8).

## 4. Forming, changing and dissolving

- **Form fleet**: at one of your colonies, outposts or depots (a "command post"), with a free command. Pick the
  flagship. It must be an armed ship, and the strongest one is suggested. The fleet gets an officer with a
  generated name (named officers are the seed of the later Admirals idea; in 1.5 they have no traits).
- **Add ships**: merge a group into a fleet anywhere both are stopped in the same system, if the points fit.
  Reinforcements can join in the field.
- **Detach ships**: anywhere. Detached ships become a group.
- **Change flagship**: at a command post, or anywhere with Subspace Command.
- **Dissolve**: anywhere. The ships become a group and the command is free at once. A group can't attack, so
  dissolving away from home doesn't get around the course rules: to attack again the ships must go back to a command
  post and form a fleet again.

## 5. Orders and movement for fleets

Without Subspace Command:

- A fleet in flight can't take a new course or halt. It flies to the destination you gave it. Automatic retreats
  after a lost battle still happen, as today (back the way it came).
- A fleet stopped at a command post takes any order.
- A fleet stopped anywhere else can be ordered only to a command post (any of yours it can reach). It can still hold,
  change stance, retreat threshold and target priority, invade, bomb or sabotage the system it is in, and take ships
  in or detach them.
- So a strike has to be planned: pick the target, go, fight, then come home or push on only if you planned the
  route through. Routes with several stops are allowed, so "via A to B" works.

**Subspace Command** (new tech) lifts both limits: change course in flight, and full orders anywhere. It also lets
a fleet change its flagship anywhere.

## 6. Flagship and officer in battle

- **Flagship destroyed**: the officer dies with it. At the end of that round the fleet breaks up. Its surviving ships
  withdraw from the battle as a beaten fleet does today: parting shots and pursuit as usual, and graviton-pinned
  ships can't leave. After the battle they are a group, back where they came from.
- **Empty command**: a new officer arrives in **5 turns**. Until then that command can't be used.
- **Command Network**: its bonuses (accuracy, evasion, +1 maneuver, the datalink techs) now need the fleet to be
  formed. If the network ship is the flagship, the fleet also gets +6 points.
- **Optional extra** (say if you want it): a new target priority, **Flagship**, aimed at enemy flagships. It is a
  way to break enemy fleets apart, at the cost of ignoring the escorts.
- A flagship outside battle that dies some other way (attrition, bombs, nanites after battle) has the same effect,
  minus the withdrawal.

## 7. New techs

| Tech | Field | Needs | Cost (approx.) | Effect |
|---|---|---|---|---|
| Naval Staff College | Logistics | Supply Lines | 400 | +4 points per command |
| Fleet Admiralty | Science | Fleet Command | 1300 | +8 points per command |
| Subspace Command | Sensors | Deep Space Arrays | 900 | Fleets change course in flight and take any order anywhere |

Final costs follow the depth scaling 1.3 introduced. All three are open to every race, with no school restriction.

## 8. Saves and the AI

**Saves (state version 18).** Loading a 1.4 game:
- Each empire's armed fleets are formed by strength, strongest first, as long as it has commands free.
- The flagship is the toughest armed ship, and the fleet keeps all its ships even if that is over the point limit.
- Other fleets become groups. Officers are named from the seeded random generator, so replays still match.

**AI.**
- **Strike forces**: it stages at the command post closest to the target, forms fleets there within its points
  (using its Command Network ship as the flagship when it has one), and launches only if the formed fleets are
  strong enough. If they aren't, it picks a weaker target or waits.
- **Invade, siege and commando raids** go only through formed fleets.
- **Defense**: groups defend colony and outpost systems. Threats elsewhere in its space need a free fleet.
- **Movement**:
  - It never retargets a fleet in flight without the tech.
  - Fleets stranded away from home go to the nearest command post.
  - After a won battle a fleet stays to invade, bomb or siege, and goes home when that is done.
- **Breakups**: survivors regroup at home.
- **Research**: values Staff College, then Subspace Command, then Admiralty, more for warlike personalities.
- **What stays the same**: the warship cap of 60 and the build rules. Sims will show whether the AI needs to build
  differently.

The AI never sees hidden state: it uses its own command limits and the enemy fleets it knows about, as now.

## 9. Screens

- **Fleet sheet**:
  - Shows "Fleet: Admiral Name, flagship X, 18/22 points" or "Group: can't attack".
  - New buttons: Form fleet (choose flagship), Dissolve, Set flagship.
  - Says why a move isn't allowed: "needs a fleet to enter enemy space", "committed to its course", "can only return
    to a colony or outpost".
- **Map**:
  - Destinations a selection can't go to are greyed out when you pick a move.
  - Fleets carry a flag mark that groups don't.
- **Fleets screen**: a line "Commands 2 of 3 in use, 22 points each, next officer in 3 turns".
- **How to play** and first-game tips: a short section on fleets and commands.

## 10. Build plan

Each part is committed and pushed, with tests. One PR for 1.5 at the end.

1. **Core rules**:
   - State: `fleet.command` (officer, flagship) and the empire's vacant-command timers.
   - Content: hull `commandPoints` and a `combat.command` block, plus the three techs and their effect keys.
   - Commands `formFleet`, `dissolveFleet`, `setFlagship`, and the movement and attack checks.
   - Save migration to version 18, with tests.
2. **Combat**: flagship loss, breakup and withdrawal, officer replacement, the network bonus only for formed fleets,
   and the size penalty only for groups. Tests.
3. **AI**: as in section 8. Full AI-game tests, and no rejected AI commands in the sims.
4. **Screens** and the How to play section. Screenshots checked on an iPhone 13 size.
5. **Balance**:
   - Before/after sims with the same seeds: 60 small games, plus medium games.
   - Reported by personality and race: win rates, game length, battles, invasions, ships lost.
   - Then the changelog and roadmap.

## 11. Defaults I picked (say if you disagree)

1. Unarmed groups (scouts, colony ships and the like) go anywhere. Only armed groups are barred from enemy systems.
2. Groups may enter your own colony and outpost systems even when enemies are there, so defense needs no command.
3. A fleet stopped away from home without Subspace Command may still be ordered back to a command post. Otherwise it
   would be stuck forever.
4. Losing the flagship kills the officer, and the command is empty for 5 turns.
5. Population growth: +1 point per command per 10 population.
6. Fleets over their limits after losses are never broken up by force.
7. Command Network flagship: +6 points.

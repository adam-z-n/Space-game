# A smarter difficulty level: design proposal

Revision 1, for the owner's approval. Nothing here is built yet.

## 1. The idea

Today the difficulty levels only change the AI's numbers: Easy produces and researches 25% less, Hard produces,
researches and earns 40% more and sees further. The AI's decisions are the same at every level.

The new level sits between Normal and Hard. Its AI empires get **no bonuses**: same production, research, credits
and sensors as the player. Instead they **play better**: bolder, better planned and quicker to adapt. Every
personality keeps its character (a turtle is still a turtle), only sharper.

Proposed name: **Veteran** (alternatives: Challenging, Tough). The order on the start screen becomes Easy, Normal,
Veteran, Hard.

## 2. How hard each level is today

The batch sim's "baseline" empire is an AI without difficulty changes, standing in for a human player; how often it
wins measures the difficulty (an even share is 20% with five empires).

| Baseline wins | Small, 60 games, 150 turns | Medium, 20 games, 200 turns |
|---|---|---|
| Normal | 25.0% | 30% |
| Hard | 11.7% | 20% |
| **Veteran (target)** | about 18% | about 25% |

## 3. What the Veteran AI does differently

All of it is data on the difficulty in the content pack (a new `ai` block), so a theme could tune it, and Hard can
use it too (section 5).

### Bolder (temperament shifts)

| Change | Effect |
|---|---|
| Aggression +2 (up to 10) | goes to war earlier (from turn 25 − aggression), aggressive stance from 7, cloaked raiding from 7 |
| Caution −2 (down to 0) | attacks with a smaller margin over the target's strength (10% less per point), fights longer before retreating, resupplies later |
| Military +1 (up to 10) | wants a stronger fleet and gives warships a bigger share of income |

A turtle (aggression 1) still never starts wars; a warlord (aggression 9) is already at its limit there and gains
mostly from less caution.

### Better planned (strategy)

1. **Picks better wars.** Today the war target is the rival with the colony nearest the AI's capital. Veteran
   weighs each known rival colony by what it is worth (population) against what it costs (its defenses, the
   rival's known fleets, and the distance from the AI's nearest command home rather than its capital), and
   prefers rivals whose fleets were last seen far from home (busy elsewhere).
2. **Counts reinforcements.** Today a strike is sized for the guards and defenses at the target only. Veteran also
   counts rival warships seen lately within two jumps, so it doesn't launch into a trap.
3. **Turns on the leader.** When one rival holds clearly more known colonies than anyone else (half as many again
   as the next), Veteran makes it the war target if it is within reach, so no empire runs away with the game. Only
   what the AI has seen counts.

### Quicker and sharper (operations and production)

| Change | Normal | Veteran |
|---|---|---|
| Cohesion before a strike launches | 80% | 70% |
| Cohesion for a campaign to push on | 60% | 50% |
| New warship design adopted when better by | 10% | 3% (fleets stay current) |
| Research leans to techs that improve its current warship (better gun, armor, shield or hull) | no | yes, weight +10 |
| Credits kept in reserve before buying builds | 30 + 8 per colony | 20 + 5 per colony |

## 4. What doesn't change

- The AI still sees only what its empire knows: no peeking through fog of war.
- Same rules, same commands as the player; no free ships, credits or research.
- Easy and Normal play exactly as now.

## 5. Questions for you

1. **Name:** Veteran, or another?
2. **Hard:** should Hard also play the Veteran way, on top of its bonuses? I recommend yes, so each level is harder
   than the one below; Hard would then be harder than today. The alternative keeps Hard as it is (bonuses only),
   which could make Veteran harder than Hard for some players.
3. **Target:** baseline wins about halfway between Normal and Hard, as in section 2?

## 6. Build plan

1. Content and schema: the `ai` block on difficulties, the Veteran level, start screen order. Tests.
2. Temperament shifts and the operations and production numbers (section 3, tables). Tests, sims.
3. Strategy: war target choice, reinforcement-aware strikes, turning on the leader. Tests, sims.
4. Balance: sims at Normal, Veteran and Hard on the same seeds; tune the numbers to land near the target; changelog.

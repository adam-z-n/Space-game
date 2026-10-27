import { attentionItems, fleetHasWarships, fleetShipStats, fleetTroops, type Game } from "../core";
import { button, h } from "./dom";

/**
 * Player guidance: a "How to play" screen of short topics, and a first-game coach that shows one
 * tip at a time when its moment comes (first turn, first colony ship, first battle...). Which tips
 * have been seen, and whether the coach is on, is kept per device in browser storage.
 */

export interface HelpTopic {
  id: string;
  title: string;
  paragraphs: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "start",
    title: "Getting started",
    paragraphs: [
      "You lead one empire among several in a galaxy of star systems joined by lanes. Each turn you give orders, then tap End turn: everyone's orders resolve at once, and the turn report says what happened.",
      "You start with a capital, a scout, a fleet of two destroyers and a colony ship. A good opening: pick a research project, send the scout exploring, and send the colony ship to the best planet nearby.",
      "The yellow \"to do\" button walks you through anything waiting for a decision: research to pick, colonies with nothing to build, and fleets without orders.",
    ],
  },
  {
    id: "map",
    title: "The map and moving fleets",
    paragraphs: [
      "Tap a system to see its planets and who holds them; tap a fleet to select it, then tap a destination to see the route and the turns it takes, and confirm. Fleets only travel along lanes you have charted.",
      "Systems are colored by what you know: grey until visited, green with a planet you can settle now, yellow with planets that need more research, dark blue with no planets.",
      "Fog of war hides what your sensors can't see. Rival fleets and colonies show where you last saw them.",
    ],
  },
  {
    id: "colonies",
    title: "Colonies and workers",
    paragraphs: [
      "Each colony's people work as farmers, industry workers or researchers. Its focus (balanced, industry, research or food) places them for you; \"+\" on a job moves a worker there by hand, and Auto hands control back.",
      "Food is shared across the empire; a shortage starves colonies. Industry builds things at the colony that makes it. Research is pooled for the whole empire. Credits come from taxes, minus upkeep.",
      "The Planets screen (menu) lists every colony's output and workers in one place, sortable by column, so you can rebalance them quickly. A colony's screen also shows its planet: type, minerals, habitability and food yield.",
    ],
  },
  {
    id: "building",
    title: "Building",
    paragraphs: [
      "Each colony has its own build queue. Tap an item to add it; ships can be queued in batches of 3 or 5 (each ship still becomes its own fleet). \"Buy now\" finishes the current item for credits.",
      "Colony ships settle planets in other systems; a colony base settles another planet in the colony's own system without a ship. Habitats (later research) settle gas giants.",
      "A colony with nothing queued sells its industry for a few credits, which wastes most of it.",
    ],
  },
  {
    id: "research",
    title: "Research",
    paragraphs: [
      "Research points from all colonies go to one project at a time. Techs give bonuses or unlock buildings, ship parts and hulls. Deeper techs cost much more.",
      "Some fields have rival schools: choosing one closes its rival. Most races can follow only one school per field (two in their specialty) and research their specialty field faster.",
      "The full research tree, with what each tech needs and unlocks, opens from the research screen.",
    ],
  },
  {
    id: "ships",
    title: "Ship design",
    paragraphs: [
      "Ship designs (menu) combine a hull with parts: weapons, armor, shields, engines and special equipment. Bigger hulls have more slots but cost more and maneuver worse. A few parts take several slots.",
      "Formation matters in battle: front-line ships draw most fire, screens shield the support ships behind them, and support ships hang back.",
      "Weapons have ranges: missiles reach long range, beams medium, mass drivers and gauss cannons short. The more maneuverable side sets the range each round.",
      "Special weapons bend the rules: graviton lances stop a fleet from withdrawing, EMP torpedoes knock out parts, nanites keep eating a ship, singularity charges hit a whole fleet, ion cannons wear shields down, phase torpedoes slip past point defense, and flak batteries double as point defense. Each part's description says what it does.",
    ],
  },
  {
    id: "fleets",
    title: "Fleets and naval commands",
    paragraphs: [
      "Ships move about in groups, but only a fleet can attack: enter a system with known enemies, invade, bomb or sabotage. Groups can always move between your own colonies and outposts, and defend them. Cloaked escorts or destroyers carrying commandos are the exception: they can sneak in and sabotage on their own.",
      "Fleets form at the home of a naval command (⚑ on the map). You start with one at your capital and gain one per 5 colonies, placed at a colony you choose. Each command has points shared by its fleets (escort 1, destroyer 2, cruiser 4, battleship 8, dreadnought 12, support ships 1), more with population and research, and one officer per fleet.",
      "A fleet commits to its course: it can't turn round in flight, and once stopped away from your colonies and outposts it can only head back to one, until you research Subspace Command. Plan the strike before you send it.",
      "Each fleet has a flagship and an officer. Lose the flagship and the officer dies with it, the fleet breaks up and falls back, and a new officer takes 5 turns. A new fleet starts at 50% cohesion and drills 10% a turn; officers gain ranks from battles. Ships in the Screen formation protect the flagship from enemies who target flagships.",
    ],
  },
  {
    id: "combat",
    title: "Combat and retreat",
    paragraphs: [
      "Battles happen when ships of rival empires meet and at least one side is armed and set to engage, or where a colony's guns can fire. Each fleet's orders set its stance, its favored targets and how much damage it takes before withdrawing.",
      "A beaten fleet retreats the way it came. No fleet can stay in orbit under a colony's working guns: knock them out in one battle, or pull back and try again with more.",
      "Freighters (troop, colony, supply and outpost ships) caught by enemy warships without an escort are destroyed. Scouts usually get away. Ships gain experience from battles and rank up from Green to Ace.",
    ],
  },
  {
    id: "supply",
    title: "Supply",
    paragraphs: [
      "Fleets refill supply and repair only at your colonies (unless blockaded) and supply depots. Every turn away costs a turn of supply; out of supply, ships slow down and fight worse.",
      "Supply ships carry stores that keep their fleet supplied in the field, reload missiles and, with Field Repair, mend damage. Resupply points show on the map whenever one of your fleets is selected.",
    ],
  },
  {
    id: "invasion",
    title: "Invasion and bombardment",
    paragraphs: [
      "To take a colony, first knock out its orbital defenses with warships. Then order troop ships in orbit to invade: they land only as many troops as a safe win needs (125% of the defenders) and the rest stay in orbit. Short of that they wait for more, unless you order an all-out landing.",
      "Bomb bays (cruisers and larger) bombard a colony whose defenses are down, killing population, garrison and buildings. Kept up long enough, bombardment wipes a colony out. Later weapons can blight a planet or destroy a colony at once.",
      "Capturing a colony can teach you one of its owner's techs.",
    ],
  },
  {
    id: "more",
    title: "Outposts, special operations and gates",
    paragraphs: [
      "Outpost ships build combat outposts (guns and sensors) or mining outposts (credits) on asteroid fields and gas giants. A combat outpost can become a supply depot. Another outpost ship can convert an outpost to the other kind (losing its depot and marks), and a habitat ship can settle a gas giant over your own outpost.",
      "Weapons research unlocks upgrade marks (I to V) for combat outposts and depots: more hit points and guns, for credits. An outpost can be upgraded only while its way home to one of your colonies is clear of known enemies.",
      "Commando ships sabotage a rival colony's defenses, garrison or buildings; cloaked ships are hard to see and slip past blockades.",
      "Warp gates (late research) let a fleet jump between two of your gated colonies in one turn.",
    ],
  },
  {
    id: "winning",
    title: "How to win",
    paragraphs: [
      "The victory mode is chosen at setup: the best score after 200 or 400 turns, Domination (hold 75% of the galaxy's population) or Total domination (all of it). Outlasting every rival always wins.",
      "In the turn-limited modes, holding half the galaxy's population wins early. In the open-ended modes, AI empires that fall far behind band together against a runaway human leader. The Empire screen shows your score and share.",
    ],
  },
];

interface Tip {
  id: string;
  topic: string;
  text: string;
  /** Whether the moment for this tip has come. */
  when: (game: Game) => boolean;
}

const own = (game: Game) => game.state.fleets.filter((f) => f.empireId === game.playerId);
const events = (game: Game) => game.state.lastTurnEvents.filter((e) => e.empireId === game.playerId);

const TIPS: Tip[] = [
  {
    id: "welcome",
    topic: "start",
    text: "Welcome! The map is centered on your home system. Tap the yellow \"to do\" button to work through what needs a decision, then End turn.",
    when: () => true,
  },
  {
    id: "colonyShip",
    topic: "building",
    text: "Your colony ship can found a new colony. Select it, tap a green system nearby, and choose Colonize when it arrives.",
    when: (game) => own(game).some((f) => fleetShipStats(game.pack, game.state, f).some((s) => s.colonize)) && game.state.turn >= 2,
  },
  {
    id: "newColony",
    topic: "colonies",
    text: "A new colony! Open it to set its focus and build queue. The Planets screen (menu) shows all your colonies at once.",
    when: (game) => game.state.colonies.filter((c) => c.empireId === game.playerId).length >= 2,
  },
  {
    id: "idleQueue",
    topic: "building",
    text: "A colony has nothing to build, so its industry is being sold off cheaply. Queue something there.",
    when: (game) => attentionItems(game.state, game.pack, game.playerId).some((a) => a.type === "emptyQueue"),
  },
  {
    id: "rival",
    topic: "combat",
    text: "You've met a rival empire. Every other empire is hostile: keep warships near your colonies and watch the borders.",
    when: (game) => events(game).some((e) => (e.type === "fleetSighted" || e.type === "colonySighted") && e.ownerId !== game.playerId),
  },
  {
    id: "battle",
    topic: "combat",
    text: "A battle was fought. Tap it in the turn report to watch the replay round by round.",
    when: (game) => events(game).some((e) => e.type === "battle"),
  },
  {
    id: "supply",
    topic: "supply",
    text: "A fleet is running low on supply. Bring it back to a colony or depot soon, or send a supply ship with it.",
    when: (game) => own(game).some((f) => f.supply > 0 && f.supply <= 2),
  },
  {
    id: "fleetsOnly",
    topic: "fleets",
    text: "Only fleets can attack. Your two destroyers start as a fleet; other warships are groups until you form them into a fleet at a naval command (⚑). Select a group there and tap Form fleet.",
    when: (game) => game.state.turn >= 3 && own(game).some((f) => !f.command && fleetHasWarships(game.pack, game.state, f)),
  },
  {
    id: "newCommand",
    topic: "fleets",
    text: "You can base a new naval command. Tap the \"to do\" button to choose the colony where its fleets will form.",
    when: (game) => attentionItems(game.state, game.pack, game.playerId).some((a) => a.type === "placeCommand"),
  },
  {
    id: "troops",
    topic: "invasion",
    text: "You have troop ships. Knock out a rival colony's defenses with warships, then order the troops in orbit to invade.",
    when: (game) => own(game).some((f) => fleetTroops(game.state, game.pack, f) > 0),
  },
];

interface CoachState {
  off: boolean;
  seen: string[];
}

export class Coach {
  private state: CoachState = { off: false, seen: [] };
  /** Turn a tip was last dismissed: the next one waits for a later turn, so tips don't pile up. */
  private quietUntil = -1;

  constructor(private readonly key: string) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) this.state = { ...this.state, ...(JSON.parse(raw) as Partial<CoachState>) };
    } catch {
      // Storage unavailable: tips start fresh each visit.
    }
  }

  get enabled(): boolean {
    return !this.state.off;
  }

  setEnabled(on: boolean): void {
    this.state.off = !on;
    if (on) this.state.seen = [];
    this.save();
  }

  /** The first tip whose moment has come and that hasn't been dismissed, or null. */
  current(game: Game): Tip | null {
    if (this.state.off || game.state.outcome || game.state.turn <= this.quietUntil) return null;
    return TIPS.find((t) => !this.state.seen.includes(t.id) && t.when(game)) ?? null;
  }

  dismiss(id: string, turn: number): void {
    this.quietUntil = turn;
    if (!this.state.seen.includes(id)) this.state.seen.push(id);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.state));
    } catch {
      // Storage unavailable: the tip comes back next visit.
    }
  }
}

/** The coach's card above the bottom bar: the tip, with "Got it", a link to its help topic, and a way to stop tips. */
export function coachCard(coach: Coach, game: Game, openTopic: (id: string) => void, refresh: () => void): HTMLElement | null {
  const tip = coach.current(game);
  if (!tip) return null;
  const topic = HELP_TOPICS.find((t) => t.id === tip.topic);
  return h(
    "div",
    { className: "sheet coach" },
    h("div", { className: "coach-text", textContent: tip.text }),
    h(
      "div",
      { className: "row" },
      button("Got it", () => {
        coach.dismiss(tip.id, game.state.turn);
        refresh();
      }, { className: "primary small-button" }),
      topic
        ? button("Tell me more", () => {
            coach.dismiss(tip.id, game.state.turn);
            openTopic(topic.id);
          }, { className: "small-button", title: topic.title })
        : null,
      button("Stop tips", () => {
        coach.setEnabled(false);
        refresh();
      }, { className: "small-button" }),
    ),
  );
}

/** The "How to play" screen: a list of topics, one open at a time. */
export function helpPanel(open: string | null, onTopic: (id: string | null) => void, close: () => void): HTMLElement {
  const list = h("ul");
  for (const topic of HELP_TOPICS) {
    const row = h("li", { className: "tappable" }, h("span", { className: "grow", textContent: topic.title }), h("span", { textContent: open === topic.id ? "▾" : "▸" }));
    row.onclick = () => onTopic(open === topic.id ? null : topic.id);
    list.append(row);
    if (open === topic.id) {
      list.append(h("li", { className: "column-item help-body" }, ...topic.paragraphs.map((p) => h("p", { textContent: p }))));
    }
  }
  return h("div", { className: "sheet panel tall" }, h("h2", {}, "How to play", button("✕", close, { ariaLabel: "Close" })), list);
}

/** Screens for naval commands, fleets and outpost marks (docs/FLEET_COMMAND.md). */
import {
  commandAt,
  commandCapacity,
  commandReady,
  commandUsed,
  findCommand,
  findFleet,
  fleetHasWarships,
  fleetPoints,
  getDesign,
  hasFlag,
  infiltratorGroup,
  isCommandPost,
  leadership,
  markTechs,
  officerRank,
  officersAllowed,
  outpostDefense,
  shipArmed,
  suggestedFlagship,
  supportedCommands,
  validateCommand,
  type Command,
  type ContentPack,
  type FleetId,
  type Game,
  type NavalCommand,
  type SystemId,
} from "../core";
import { button, h } from "./dom";

export interface CommandContext {
  game: Game;
  pack: ContentPack;
  issue(command: Command): boolean;
  systemName(id: SystemId): string;
}

/** "Veteran Voss" (the lowest rank shows as "Officer"). */
export function officerTitle(pack: ContentPack, officer: { name: string; xp: number }): string {
  return `${officerRank(pack, officer.xp).name} ${officer.name}`;
}

/** Points and officers in use for a command, and when the next officer arrives. */
export function commandLine(ctx: CommandContext, command: NavalCommand): string {
  const { game, pack } = ctx;
  const empire = game.state.empires[game.playerId]!;
  const fleets = game.state.fleets.filter((f) => f.empireId === empire.id && f.command?.commandId === command.id).length;
  const where = command.homeSystemId === null ? "no home (move it)" : `at ${ctx.systemName(command.homeSystemId)}`;
  const setup = command.homeSystemId !== null && !commandReady(game.state, command) ? ` · ready in ${command.readyTurn - game.state.turn} turn${command.readyTurn - game.state.turn > 1 ? "s" : ""}` : "";
  const next = command.vacancies.length > 0 ? ` · next officer in ${Math.max(0, Math.min(...command.vacancies) - game.state.turn)} turns` : "";
  return `${command.name} ${where}: ${fleets} of ${officersAllowed(pack, empire)} officers, ${commandUsed(game.state, pack, empire, command)} of ${commandCapacity(game.state, pack, empire, command)} points${setup}${next}`;
}

/**
 * The fleet sheet's command section: who leads it and how drilled it is, or why a group can't attack
 * and how to form it into a fleet.
 */
export function fleetCommandSection(ctx: CommandContext, fleetId: FleetId): HTMLElement | null {
  const { game, pack } = ctx;
  const fleet = findFleet(game.state, fleetId);
  if (!fleet || fleet.empireId !== game.playerId) return null;
  const empire = game.state.empires[game.playerId]!;
  const lines: (HTMLElement | null)[] = [];
  const actions = h("div", { className: "row" });
  const subspace = hasFlag(pack, empire, "subspaceCommand");

  if (fleet.command) {
    const command = findCommand(empire, fleet.command.commandId);
    const flagship = fleet.ships.find((s) => s.id === fleet.command!.flagshipId);
    const lead = leadership(pack, fleet);
    lines.push(h("div", { className: "small", textContent: `Fleet · ${officerTitle(pack, fleet.command.officer)} · ${command?.name ?? "command lost"}` }));
    lines.push(
      h("div", {
        className: "muted small",
        textContent: `Flagship ${flagship ? getDesign(empire, flagship.designId).name : "lost"} · cohesion ${fleet.command.cohesion}%${lead.drill > 0 ? ` (−${lead.drill}% accuracy)` : ""}${lead.bonus > 0 ? ` · rank +${lead.bonus}%` : ""} · ${fleetPoints(pack, game.state, fleet)} points`,
      }),
    );
    if (fleet.progress > 0 && !subspace) lines.push(h("div", { className: "warn-text small", textContent: "Committed to its course until it arrives (Subspace Command lifts this)." }));
    else if (fleet.progress === 0 && !subspace && !isCommandPost(game.state, empire.id, fleet.systemId)) {
      lines.push(h("div", { className: "warn-text small", textContent: "Away from home: it can only be sent back to one of your colonies or outposts." }));
    }
    actions.append(
      button("Dissolve", () => {
        if (confirm(`Turn ${fleet.name} back into a group? Its officer returns to ${command?.name ?? "the reserve"}, and a group can't attack.`)) {
          ctx.issue({ type: "dissolveFleet", empireId: empire.id, fleetId: fleet.id });
        }
      }),
    );
    // Another design can take over as flagship (one button per design), where that is allowed.
    const seen = new Set<string>(flagship ? [flagship.designId] : []);
    for (const ship of fleet.ships) {
      if (ship.id === fleet.command.flagshipId || seen.has(ship.designId) || !shipArmed(pack, empire, ship)) continue;
      seen.add(ship.designId);
      const order: Command = { type: "setFlagship", empireId: empire.id, fleetId: fleet.id, shipId: ship.id };
      if (validateCommand(game.state, order, pack) === null) actions.append(button(`Flagship: ${getDesign(empire, ship.designId).name}`, () => ctx.issue(order), { className: "small-button" }));
    }
  } else {
    const warships = fleetHasWarships(pack, game.state, fleet);
    if (infiltratorGroup(pack, game.state, fleet)) {
      lines.push(h("div", { className: "small", textContent: "Infiltrators: cloaked and small, they can slip into enemy systems and sabotage without a fleet." }));
    } else if (warships) {
      lines.push(h("div", { className: "small", textContent: "Group: not in a fleet, so it can't enter systems with known enemies, invade, bomb or sabotage. It can always go to your own colonies and outposts." }));
    } else {
      lines.push(h("div", { className: "muted small", textContent: "Group: support ships need a fleet to invade or bomb." }));
    }
    const home = fleet.progress === 0 ? commandAt(empire, fleet.systemId) : undefined;
    const flagship = suggestedFlagship(pack, game.state, fleet);
    if (home && flagship) {
      const form: Command = { type: "formFleet", empireId: empire.id, fleetId: fleet.id, flagshipId: flagship.id };
      const blocker = validateCommand(game.state, form, pack);
      if (blocker === null) {
        actions.append(button(`Form fleet in ${home.name} (${fleetPoints(pack, game.state, fleet)} pts)`, () => ctx.issue(form), { className: "primary" }));
        lines.push(h("div", { className: "muted small", textContent: `Flagship: ${getDesign(empire, flagship.designId).name}. A new fleet starts at 50% cohesion and drills 10% a turn.` }));
      } else {
        lines.push(h("div", { className: "warn-text small", textContent: `Can't form a fleet here: ${blocker}.` }));
      }
    } else if (warships) {
      const homes = empire.navalCommands.filter((c) => c.homeSystemId !== null).map((c) => ctx.systemName(c.homeSystemId!));
      lines.push(h("div", { className: "muted small", textContent: `Fleets form where a naval command is based${homes.length ? `: ${homes.join(", ")}` : ""}.` }));
    }
  }
  return h("div", { className: "command-section" }, ...lines, actions.childElementCount > 0 ? actions : null);
}

/** The Fleets screen's list of naval commands; tapping one shows its home. */
export function commandsList(ctx: CommandContext, locate: (systemId: SystemId) => void, place: (commandId: number | null) => void): HTMLElement {
  const { game, pack } = ctx;
  const empire = game.state.empires[game.playerId]!;
  const list = h("ul");
  list.append(h("li", { className: "section" }, h("span", { textContent: "Naval commands" })));
  for (const command of empire.navalCommands) {
    const row = h("li", { className: "tappable" }, h("span", { className: "small", textContent: commandLine(ctx, command) }));
    row.onclick = () => (command.homeSystemId === null ? place(command.id) : locate(command.homeSystemId));
    list.append(row);
  }
  const supported = supportedCommands(game.state, pack, empire.id);
  if (empire.navalCommands.length < supported) {
    const row = h("li", { className: "tappable" }, h("span", { className: "small", style: "text-align:left", textContent: "A new command is available: tap to base it at one of your colonies ›" }));
    row.onclick = () => place(null);
    list.append(row);
  } else {
    const per = pack.combat.command.coloniesPerCommand;
    const colonies = game.state.colonies.filter((c) => c.empireId === empire.id).length;
    list.append(h("li", {}, h("span", { className: "muted small", textContent: `Next command at ${supported * per} colonies (you have ${colonies}).` })));
  }
  return list;
}

/** What a command placement will do, for the banner while picking a system. */
export function placingText(ctx: CommandContext, commandId: number | null): string {
  const empire = ctx.game.state.empires[ctx.game.playerId]!;
  const command = commandId === null ? null : findCommand(empire, commandId);
  const name = command?.name ?? "the new command";
  const turns = commandId === null ? ctx.pack.combat.command.newCommandTurns : ctx.pack.combat.command.relocateTurns;
  return `Tap one of your colony systems to base ${name} there (circled on the map). Fleets form only where a command is based; it is ready ${turns} turns after.`;
}

/** Systems where a command could be based now: the player's colony systems with no command yet. */
export function commandSites(game: Game): SystemId[] {
  const empire = game.state.empires[game.playerId]!;
  const taken = new Set(empire.navalCommands.map((c) => c.homeSystemId));
  return [...new Set(game.state.colonies.filter((c) => c.empireId === empire.id).map((c) => c.systemId))].filter((s) => !taken.has(s)).sort((a, b) => a - b);
}

/** An outpost's mark and its next upgrade (cost and stats), or why it isn't available. */
export function outpostMarkControl(ctx: CommandContext, outpostId: number): HTMLElement | null {
  const { game, pack } = ctx;
  const outpost = game.state.outposts.find((o) => o.id === outpostId);
  if (!outpost || outpost.empireId !== game.playerId || outpost.kind !== "combat") return null;
  const empire = game.state.empires[game.playerId]!;
  const next = pack.outposts.marks[outpost.mark];
  if (!next) return h("span", { className: "muted small", textContent: "Highest mark" });
  const order: Command = { type: "upgradeOutpostMark", empireId: empire.id, outpostId };
  const blocker = validateCommand(game.state, order, pack);
  const label = `Mark ${roman(outpost.mark + 1)} · ${next.cost} ¢`;
  const guns = next.weapons.reduce((n, w) => n + w.count, 0);
  const title = `${next.hp} hit points, ${guns} guns (${next.weapons.map((w) => `${w.count} × ${w.damage}`).join(", ")}), upkeep ${next.upkeep}`;
  if (blocker === null) return button(label, () => ctx.issue(order), { className: "small-button", title });
  const known = markTechs(pack, empire);
  const why = known < next.weaponsTechs ? `${label}: needs ${next.weaponsTechs} weapons techs (${known})` : `${label}: ${blocker}`;
  return h("span", { className: "muted small", textContent: why });
}

/** Mark shown with an outpost's name. */
export function markLabel(mark: number): string {
  return mark > 0 ? ` Mk ${roman(mark)}` : "";
}

function roman(n: number): string {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] ?? String(n);
}

/** Current outpost hit points against its mark's maximum. */
export function outpostHp(game: Game, pack: ContentPack, outpostId: number): string {
  const outpost = game.state.outposts.find((o) => o.id === outpostId);
  if (!outpost) return "";
  return `${outpost.defenseHp}/${outpostDefense(pack, game.state.empires[outpost.empireId]!, outpost).maxHp} hp`;
}

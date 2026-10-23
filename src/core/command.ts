/**
 * Naval commands, officers and fleets (docs/FLEET_COMMAND.md).
 *
 * Ships move about in loose groups. Only a group formed into a fleet, under a naval command with an
 * officer and a flagship, may enter systems with known enemies, invade, bomb or sabotage. Each
 * command is based at a system, where its fleets form, and holds a pool of points its fleets share.
 */
import type { ContentPack } from "../content/schema";
import { findPath, type Neighbor } from "./graph";
import { empireEffects, hasFlag } from "./economy";
import { designStats, fleetShipStats, getDesign, getHull } from "./ships";
import { inSensorRange, knownAdjacency, sensorSources } from "./vision";
import type { Empire, EmpireId, Fleet, GameEvent, GameState, NavalCommand, Officer, Ship, SystemId } from "./state";

export const commandRules = (pack: ContentPack) => pack.combat.command;

/** Sightings count as known enemy positions for this many turns. */
export const KNOWN_SIGHTING_TURNS = 3;

/** Points one ship uses: its hull's for an armed ship (judged by design), the support rate otherwise. */
export function shipPoints(pack: ContentPack, empire: Empire, ship: Ship): number {
  const design = getDesign(empire, ship.designId);
  return designStats(pack, design, empireEffects(pack, empire)).armed ? getHull(pack, design.hull).commandPoints : commandRules(pack).supportPoints;
}

export function fleetPoints(pack: ContentPack, state: GameState, fleet: Fleet): number {
  const empire = state.empires[fleet.empireId]!;
  return fleet.ships.reduce((n, ship) => n + shipPoints(pack, empire, ship), 0);
}

/** Armed by design (knocked-out guns still count): such groups can't enter enemy space. */
export function fleetHasWarships(pack: ContentPack, state: GameState, fleet: Fleet): boolean {
  const empire = state.empires[fleet.empireId]!;
  const fx = empireEffects(pack, empire);
  return fleet.ships.some((ship) => designStats(pack, getDesign(empire, ship.designId), fx).armed);
}

export function shipArmed(pack: ContentPack, empire: Empire, ship: Ship): boolean {
  return designStats(pack, getDesign(empire, ship.designId), empireEffects(pack, empire)).armed;
}

/**
 * Infiltrators: a group made only of cloaked ships on small (infiltrator) hulls, carrying commandos. Sneaking in
 * is their trade, so they may enter enemy systems and sabotage without a naval command (but not invade or bomb).
 */
export function infiltratorGroup(pack: ContentPack, state: GameState, fleet: Fleet): boolean {
  if (fleet.command || fleet.ships.length === 0) return false;
  const empire = state.empires[fleet.empireId]!;
  const stats = fleetShipStats(pack, state, fleet);
  return (
    stats.some((s) => s.commandos > 0) &&
    fleet.ships.every((ship, i) => stats[i]!.stealth && getHull(pack, getDesign(empire, ship.designId).hull).infiltrator)
  );
}

/** Commands an empire can support: one, plus one per so many colonies. */
export function supportedCommands(state: GameState, pack: ContentPack, empireId: EmpireId): number {
  const colonies = state.colonies.filter((c) => c.empireId === empireId).length;
  return 1 + Math.floor(colonies / commandRules(pack).coloniesPerCommand);
}

export function fleetsOf(state: GameState, empireId: EmpireId, commandId: number): Fleet[] {
  return state.fleets.filter((f) => f.empireId === empireId && f.command?.commandId === commandId);
}

/** Whether a fleet's flagship carries a Fleet Command Network. */
export function flagshipHasNetwork(pack: ContentPack, state: GameState, fleet: Fleet): boolean {
  if (!fleet.command) return false;
  const empire = state.empires[fleet.empireId]!;
  const flagship = fleet.ships.find((s) => s.id === fleet.command!.flagshipId);
  return !!flagship && designStats(pack, getDesign(empire, flagship.designId), empireEffects(pack, empire)).command > 0;
}

/** A command's points: base, population, techs, and Command Network flagships among its fleets. */
export function commandCapacity(state: GameState, pack: ContentPack, empire: Empire, command: NavalCommand): number {
  const rules = commandRules(pack);
  const population = state.colonies.filter((c) => c.empireId === empire.id).reduce((n, c) => n + c.population, 0);
  const networks = fleetsOf(state, empire.id, command.id).filter((f) => flagshipHasNetwork(pack, state, f)).length;
  return rules.basePoints + Math.floor(population / rules.populationPerPoint) + empireEffects(pack, empire).commandPoints + networks * rules.networkPoints;
}

export function commandUsed(state: GameState, pack: ContentPack, empire: Empire, command: NavalCommand): number {
  return fleetsOf(state, empire.id, command.id).reduce((n, f) => n + fleetPoints(pack, state, f), 0);
}

export function officersAllowed(pack: ContentPack, empire: Empire): number {
  return commandRules(pack).officers + empireEffects(pack, empire).commandOfficers;
}

/** Officers free to take a new fleet: allowed, less those leading fleets, less places awaiting a replacement. */
export function freeOfficers(state: GameState, pack: ContentPack, empire: Empire, command: NavalCommand): number {
  return officersAllowed(pack, empire) - fleetsOf(state, empire.id, command.id).length - command.vacancies.length;
}

export function findCommand(empire: Empire, commandId: number): NavalCommand | undefined {
  return empire.navalCommands.find((c) => c.id === commandId);
}

export function commandAt(empire: Empire, systemId: SystemId): NavalCommand | undefined {
  return empire.navalCommands.find((c) => c.homeSystemId === systemId);
}

export function commandReady(state: GameState, command: NavalCommand): boolean {
  return command.homeSystemId !== null && state.turn >= command.readyTurn;
}

/** A system with one of the empire's colonies or outposts: fleets stopped there take any order. */
export function isCommandPost(state: GameState, empireId: EmpireId, systemId: SystemId): boolean {
  return state.colonies.some((c) => c.empireId === empireId && c.systemId === systemId) || state.outposts.some((o) => o.empireId === empireId && o.systemId === systemId);
}

export function hasColonyIn(state: GameState, empireId: EmpireId, systemId: SystemId): boolean {
  return state.colonies.some((c) => c.empireId === empireId && c.systemId === systemId);
}

/**
 * Systems where the empire knows of enemies: armed rival fleets sighted there lately, rival colonies on
 * its charts, and rival outposts in sensor range. Only what the empire knows, never hidden state.
 */
export function knownHostileSystems(state: GameState, pack: ContentPack, empireId: EmpireId, sources = sensorSources(state, pack, empireId)): Set<SystemId> {
  const empire = state.empires[empireId]!;
  const hostile = new Set<SystemId>();
  for (const s of empire.sightings) if (s.armed && s.nextSystemId === null && s.turn >= state.turn - KNOWN_SIGHTING_TURNS) hostile.add(s.systemId);
  for (const c of empire.colonySightings) hostile.add(c.systemId);
  for (const o of state.outposts) {
    if (o.empireId !== empireId && inSensorRange(sources, state.galaxy.systems[o.systemId]!)) hostile.add(o.systemId);
  }
  return hostile;
}

/** The lane graph without the given systems (so routes go around them). */
export function adjacencyAvoiding(adj: readonly Neighbor[][], avoid: ReadonlySet<SystemId>, keep: SystemId): Neighbor[][] {
  return adj.map((list, id) => (avoid.has(id) && id !== keep ? [] : list.filter((n) => !avoid.has(n.id) || n.id === keep)));
}

/** Why a fleet in a command can't be sent to `destinationId` right now (without Subspace Command), or null. */
export function fleetOrderBlocker(state: GameState, pack: ContentPack, fleet: Fleet, destinationId: SystemId): string | null {
  if (!fleet.command) return null;
  const empire = state.empires[fleet.empireId]!;
  if (hasFlag(pack, empire, "subspaceCommand")) return null;
  if (fleet.progress > 0) return "the fleet is committed to its course (Subspace Command lifts this)";
  if (isCommandPost(state, fleet.empireId, fleet.systemId)) return null;
  // Away from home a fleet can only be called back to a colony or outpost (or told to stay put).
  if (destinationId === fleet.systemId || isCommandPost(state, fleet.empireId, destinationId)) return null;
  return "away from your colonies and outposts, a fleet can only return to one (Subspace Command lifts this)";
}

/** Officer for a new fleet: the most experienced in reserve, else a new one (named from the content list by id). */
export function takeOfficer(state: GameState, pack: ContentPack, command: NavalCommand): Officer {
  if (command.reserve.length > 0) {
    command.reserve.sort((a, b) => b.xp - a.xp || a.id - b.id);
    return command.reserve.shift()!;
  }
  const id = state.nextId++;
  const names = commandRules(pack).officerNames;
  return { id, name: names[(id * 7) % names.length]!, xp: 0 };
}

/** Rank name and bonus (accuracy and evasion, percent) for an officer's experience. */
export function officerRank(pack: ContentPack, xp: number): { name: string; bonus: number } {
  const ranks = commandRules(pack).officerRanks;
  let rank = ranks[0]!;
  for (const r of ranks) if (xp >= r.xp) rank = r;
  return { name: rank.name, bonus: rank.bonus };
}

/** Ordinal names: 1st Command, 2nd Command... the lowest number not in use. */
export function nextCommandName(empire: Empire): string {
  const used = new Set(empire.navalCommands.map((c) => c.name));
  for (let n = 1; ; n++) {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
    const name = `${n}${suffix} Command`;
    if (!used.has(name)) return name;
  }
}

export function newCommand(state: GameState, empire: Empire, homeSystemId: SystemId | null, readyTurn: number): NavalCommand {
  const command: NavalCommand = { id: state.nextId++, name: nextCommandName(empire), homeSystemId, readyTurn, reserve: [], vacancies: [] };
  empire.navalCommands.push(command);
  return command;
}

/** The armed ship that should lead a fleet: toughest by design hit points, then lowest id. */
export function suggestedFlagship(pack: ContentPack, state: GameState, fleet: Fleet): Ship | undefined {
  const empire = state.empires[fleet.empireId]!;
  const stats = fleetShipStats(pack, state, fleet);
  let best: { ship: Ship; score: number } | undefined;
  fleet.ships.forEach((ship, i) => {
    const s = stats[i]!;
    if (!shipArmed(pack, empire, ship)) return;
    const score = s.maxHp + (s.command > 0 ? 100_000 : 0);
    if (!best || score > best.score) best = { ship, score };
  });
  return best?.ship;
}

/** Break a fleet up into a group: its officer goes back to the reserve (alive) or is lost. */
export function releaseOfficer(state: GameState, pack: ContentPack, fleet: Fleet, killed: boolean): void {
  if (!fleet.command) return;
  const empire = state.empires[fleet.empireId]!;
  const command = findCommand(empire, fleet.command.commandId);
  if (command) {
    if (killed) command.vacancies.push(state.turn + commandRules(pack).officerReplaceTurns);
    else command.reserve.push(fleet.command.officer);
  }
  fleet.command = null;
}

/**
 * Chain of Command: when a fleet's flagship is lost, its officer with it, the toughest armed ship left takes
 * over under a field-promoted officer (the most experienced in reserve, else a new one) and cohesion falls back.
 * Returns false (nothing changed) without the tech or an armed ship to lead.
 */
export function promoteFlagship(state: GameState, pack: ContentPack, fleet: Fleet, events: GameEvent[]): boolean {
  if (!fleet.command) return false;
  const empire = state.empires[fleet.empireId]!;
  const command = findCommand(empire, fleet.command.commandId);
  const next = suggestedFlagship(pack, state, fleet);
  if (!hasFlag(pack, empire, "chainOfCommand") || !command || !next) return false;
  events.push({ type: "flagshipLost", turn: state.turn, empireId: fleet.empireId, fleetId: fleet.id, systemId: fleet.systemId, officer: fleet.command.officer.name, heldTogether: true });
  fleet.command = { ...fleet.command, officer: takeOfficer(state, pack, command), flagshipId: next.id, cohesion: Math.min(fleet.command.cohesion, commandRules(pack).cohesionStart) };
  return true;
}

/**
 * Bookkeeping each turn, after battles, invasions and bombing:
 * officers lost with fleets wiped out or flagships destroyed, replacements arriving, cohesion,
 * and commands whose home system fell (moved if the empire can still support them, else lost).
 * `formedBefore` lists the fleets that were in a command when the turn began.
 */
export function resolveCommands(state: GameState, pack: ContentPack, events: GameEvent[], formedBefore: Map<number, { empireId: EmpireId; commandId: number }>): void {
  const rules = commandRules(pack);
  const alive = new Set(state.fleets.map((f) => f.id));
  for (const [fleetId, { empireId, commandId }] of [...formedBefore].sort((a, b) => a[0] - b[0])) {
    if (alive.has(fleetId)) continue;
    // The whole fleet was destroyed: its officer went down with the flagship.
    const command = findCommand(state.empires[empireId]!, commandId);
    command?.vacancies.push(state.turn + rules.officerReplaceTurns);
  }
  for (const fleet of [...state.fleets].sort((a, b) => a.id - b.id)) {
    if (!fleet.command) continue;
    if (!fleet.ships.some((s) => s.id === fleet.command!.flagshipId)) {
      if (promoteFlagship(state, pack, fleet, events)) continue;
      events.push({ type: "flagshipLost", turn: state.turn, empireId: fleet.empireId, fleetId: fleet.id, systemId: fleet.systemId, officer: fleet.command.officer.name, heldTogether: false });
      releaseOfficer(state, pack, fleet, true);
      continue;
    }
    fleet.command.cohesion = Math.min(100, fleet.command.cohesion + rules.cohesionPerTurn);
  }
  for (const empire of state.empires) {
    if (empire.eliminated) continue;
    // A replacement due on turn t can take a fleet from that turn's orders on (the turn is about to advance).
    for (const command of empire.navalCommands) command.vacancies = command.vacancies.filter((t) => t > state.turn + 1);
    for (const command of [...empire.navalCommands]) {
      const home = command.homeSystemId;
      if (home === null || hasColonyIn(state, empire.id, home)) continue;
      if (empire.navalCommands.length <= supportedCommands(state, pack, empire.id)) {
        command.homeSystemId = null;
        events.push({ type: "commandDisplaced", turn: state.turn, empireId: empire.id, commandId: command.id, systemId: home });
      } else {
        empire.navalCommands = empire.navalCommands.filter((c) => c.id !== command.id);
        for (const fleet of fleetsOf(state, empire.id, command.id)) fleet.command = null;
        events.push({ type: "commandLost", turn: state.turn, empireId: empire.id, commandId: command.id, systemId: home, name: command.name });
      }
    }
  }
}

/** Fleets in a command when a turn starts, to tell later which were wiped out. */
export function formedFleets(state: GameState): Map<number, { empireId: EmpireId; commandId: number }> {
  return new Map(state.fleets.filter((f) => f.command).map((f) => [f.id, { empireId: f.empireId, commandId: f.command!.commandId }]));
}

/** Number of the empire's techs in the field that unlocks outpost marks. */
export function markTechs(pack: ContentPack, empire: Empire): number {
  const field = pack.outposts.marksField;
  return empire.techs.filter((id) => pack.techs.find((t) => t.id === id)?.field === field).length;
}

/**
 * Whether an outpost has a clear way home: a lane route to one of the empire's colonies on which no
 * system (the two ends included) holds a known enemy fleet, outpost or colony.
 */
export function outpostPathBlocker(state: GameState, pack: ContentPack, empireId: EmpireId, systemId: SystemId): string | null {
  const hostile = knownHostileSystems(state, pack, empireId);
  const name = (id: SystemId) => state.galaxy.systems[id]!.name;
  if (hostile.has(systemId)) return `under threat: enemies at ${name(systemId)}`;
  const adj = adjacencyAvoiding(knownAdjacency(state, empireId), hostile, -1);
  const homes = [...new Set(state.colonies.filter((c) => c.empireId === empireId && !hostile.has(c.systemId)).map((c) => c.systemId))].sort((a, b) => a - b);
  if (homes.includes(systemId)) return null;
  for (const home of homes) if (findPath(adj, systemId, home)) return null;
  return "cut off: enemies stand between it and your colonies";
}

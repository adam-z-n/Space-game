import type { ContentPack } from "../content/schema";
import { planAiTurn } from "./ai";
import { applyCommand, type Command } from "./commands";
import { createInitialState } from "./setup";
import type { EmpireId, GameEvent, GameSettings, GameState } from "./state";

/** Rebuild a game's state from its settings and command log. */
export function replay(settings: GameSettings, log: readonly Command[], pack: ContentPack): GameState {
  let state = createInitialState(settings, pack);
  for (const [i, command] of log.entries()) {
    const result = applyCommand(state, command, pack);
    if (!result.ok) throw new Error(`replay failed at command ${i} (${command.type}): ${result.error}`);
    state = result.state;
  }
  return state;
}

/**
 * A game in progress: current state, the full command log, and undo for the
 * current orders phase. This is the only object the UI talks to.
 */
export class Game {
  private turnStart: GameState;
  private turnStartLogLength: number;

  constructor(
    readonly pack: ContentPack,
    private current: GameState,
    private readonly commandLog: Command[] = [],
  ) {
    this.turnStart = current;
    this.turnStartLogLength = commandLog.length;
  }

  static create(settings: GameSettings, pack: ContentPack): Game {
    return new Game(pack, createInitialState(settings, pack));
  }

  get state(): GameState {
    return this.current;
  }

  get log(): readonly Command[] {
    return this.commandLog;
  }

  get playerId(): EmpireId {
    return 0;
  }

  /** Issue an order during the orders phase. Returns an error message if rejected. */
  issue(command: Command): string | null {
    if (command.type === "endTurn") return "use endTurn()";
    return this.apply(command);
  }

  get canUndo(): boolean {
    return this.commandLog.length > this.turnStartLogLength;
  }

  /** Undo the player's most recent order this turn. */
  undo(): boolean {
    if (!this.canUndo) return false;
    this.commandLog.pop();
    let state = this.turnStart;
    for (const command of this.commandLog.slice(this.turnStartLogLength)) {
      const result = applyCommand(state, command, this.pack);
      if (!result.ok) throw new Error(`undo replay failed: ${result.error}`);
      state = result.state;
    }
    this.current = state;
    return true;
  }

  /** AI empires issue their orders, then the turn resolves. Returns the turn report. */
  endTurn(): GameEvent[] {
    for (const empire of this.current.empires) {
      if (!empire.isAI || empire.eliminated) continue;
      for (const command of planAiTurn(this.current, this.pack, empire.id)) {
        const error = this.apply(command);
        if (error) throw new Error(`AI ${empire.id} issued an invalid command: ${error}`);
      }
    }
    const error = this.apply({ type: "endTurn" });
    if (error) throw new Error(error);
    this.turnStart = this.current;
    this.turnStartLogLength = this.commandLog.length;
    return this.current.lastTurnEvents;
  }

  private apply(command: Command): string | null {
    const result = applyCommand(this.current, command, this.pack);
    if (!result.ok) return result.error;
    this.current = result.state;
    this.commandLog.push(command);
    return null;
  }
}

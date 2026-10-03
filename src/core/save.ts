import type { ContentPack } from "../content/schema";
import { hashString } from "./rng";
import { Game } from "./game";
import type { Command } from "./commands";
import { STATE_VERSION, type GameState } from "./state";

export const SAVE_FORMAT = 1;

/**
 * A save holds both the current state (for instant resume) and the command log
 * (for replays, debugging, and verifying determinism).
 */
export interface SaveGame {
  format: number;
  contentPack: { id: string; version: string };
  turn: number;
  state: GameState;
  log: Command[];
}

export function toSave(game: Game): SaveGame {
  return {
    format: SAVE_FORMAT,
    contentPack: { ...game.state.contentPack },
    turn: game.state.turn,
    state: game.state,
    log: [...game.log],
  };
}

export function serializeSave(game: Game): string {
  return JSON.stringify(toSave(game));
}

export function deserializeSave(json: string, pack: ContentPack): Game {
  const save = JSON.parse(json) as Partial<SaveGame>;
  if (save.format !== SAVE_FORMAT) throw new Error(`unsupported save format ${String(save.format)}`);
  if (!save.state || !Array.isArray(save.log)) throw new Error("corrupt save");
  if (save.state.version !== STATE_VERSION) throw new Error(`unsupported state version ${save.state.version}`);
  if (save.contentPack?.id !== pack.id) throw new Error(`save needs content pack "${save.contentPack?.id}"`);
  return new Game(pack, save.state, save.log);
}

/** Stable fingerprint of a state, for determinism checks. */
export function stateHash(state: GameState): string {
  return hashString(JSON.stringify(state)).toString(16).padStart(8, "0");
}

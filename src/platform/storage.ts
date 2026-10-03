/**
 * Where saves live. The game only talks to this interface, so moving from the
 * browser to a native app means writing one new implementation (e.g. on
 * Capacitor's Filesystem or Preferences plugin), not touching game code.
 */
export interface SaveStore {
  read(slot: string): Promise<string | null>;
  write(slot: string, data: string): Promise<void>;
  remove(slot: string): Promise<void>;
}

/** Browser storage. Note: browsers may evict this, so the web build also offers save export. */
export class LocalSaveStore implements SaveStore {
  constructor(private readonly prefix = "space4x:save:") {}

  async read(slot: string): Promise<string | null> {
    try {
      return localStorage.getItem(this.prefix + slot);
    } catch {
      return null;
    }
  }

  async write(slot: string, data: string): Promise<void> {
    localStorage.setItem(this.prefix + slot, data);
  }

  async remove(slot: string): Promise<void> {
    try {
      localStorage.removeItem(this.prefix + slot);
    } catch {
      // Storage unavailable (private mode); nothing to remove.
    }
  }
}

export class MemorySaveStore implements SaveStore {
  private readonly slots = new Map<string, string>();

  async read(slot: string): Promise<string | null> {
    return this.slots.get(slot) ?? null;
  }

  async write(slot: string, data: string): Promise<void> {
    this.slots.set(slot, data);
  }

  async remove(slot: string): Promise<void> {
    this.slots.delete(slot);
  }
}

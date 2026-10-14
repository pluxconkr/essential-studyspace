/**
 * Web fallback for the key-value store: localStorage with an in-memory mirror.
 * Web is a "must not crash" target, not the product target.
 *
 * Metro picks this file over `kv.ts` on web. Same surface (plus `keys()`); values are stored in localStorage
 * as `studyspace:<key>`, and `update()` is a plain read-then-write, not a transaction.
 */
/** Values written this session, as JSON; read only when localStorage has nothing for the key. */
const mem = new Map<string, string>();

/** localStorage, or null when this environment has none or refuses access to it (the access itself can throw). */
function ls(): Storage | null {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

/** Namespaces this app's keys inside the origin's shared localStorage; keys() and clear() rely on it. */
const PREFIX = 'studyspace:';

/** Same surface as the native `kv` (get, lastWriteOk, set, update, remove, clear) plus `keys()`. */
export const kv = {
  /**
   * The value parsed from JSON: localStorage first, then the in-memory mirror; null when missing or unparseable.
   * One catch: after a refused write, an older localStorage value for the same key still wins over the mirror.
   */
  get<T>(key: string): T | null {
    try {
      const raw = ls()?.getItem(PREFIX + key) ?? mem.get(key) ?? null;
      return raw == null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  },
  /** false when localStorage refused the last write (quota, private mode); that value then lives only in memory. */
  lastWriteOk: true,
  /** Writes to the in-memory mirror, then to localStorage; true when localStorage accepted it. */
  set(key: string, value: unknown): boolean {
    const raw = JSON.stringify(value);
    mem.set(key, raw);
    try {
      ls()?.setItem(PREFIX + key, raw);
      this.lastWriteOk = true;
    } catch {
      /* quota / private mode — the in-memory copy still serves this session */
      this.lastWriteOk = false;
    }
    return this.lastWriteOk;
  },
  /** get, apply `fn`, set: not atomic like the native transaction. Returns the new value even when localStorage refused it. */
  update<T>(key: string, fn: (prev: T | null) => T): T {
    const next = fn(this.get<T>(key));
    this.set(key, next);
    return next;
  },
  /** Deletes the key from the mirror and from localStorage; a failure is ignored. */
  remove(key: string): void {
    mem.delete(key);
    try {
      ls()?.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
  /** This app's keys without the prefix: from localStorage, or from the mirror when there is none. Web only; clear() uses it. */
  keys(): string[] {
    const s = ls();
    if (!s) return [...mem.keys()];
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  },
  /** Removes this app's keys (other localStorage entries stay) and empties the mirror. */
  clear(): void {
    for (const k of this.keys()) this.remove(k);
    mem.clear();
  },
};

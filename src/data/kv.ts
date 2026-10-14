/**
 * Synchronous key-value store backed by SQLite (expo-sqlite/kv-store).
 * Values are JSON. Reads are synchronous so the first frame renders from disk.
 *
 * Web gets `kv.web.ts` (localStorage) — expo-sqlite is never bundled for web.
 *
 * The app reaches it through `repos.ts`, which adds typed repositories and the low-storage guard on top.
 * Storage errors never throw from here: reads come back null, writes report failure through their return
 * value and `lastWriteOk`.
 */
import { SQLiteStorage } from 'expo-sqlite/kv-store';

/** The app's one kv database ("studyspace"); every key in `repos.ts` KEYS lives in it. */
const store = new SQLiteStorage('studyspace');

/** JSON key-value access for the repositories; every call is synchronous. */
export const kv = {
  /**
   * The stored value parsed from JSON, or null when the key is missing, the JSON does not parse or the read
   * fails. The cast to `T` is not checked: callers that need a valid shape sanitize it (see sanitizePrefs).
   */
  get<T>(key: string): T | null {
    try {
      const raw = store.getItemSync(key);
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  /**
   * false when the write did not reach disk (e.g. the phone is out of space).
   * Set by every set() and update(); the storage guard reads it after update(), which returns a value either way.
   */
  lastWriteOk: true,
  /** Writes one value as JSON. False (and lastWriteOk false, with a warning in development) when the write fails. */
  set(key: string, value: unknown): boolean {
    try {
      store.setItemSync(key, JSON.stringify(value));
      this.lastWriteOk = true;
      return true;
    } catch (e) {
      if (__DEV__) console.warn('[kv] set failed', key, e);
      this.lastWriteOk = false;
      return false;
    }
  },
  /**
   * Atomic read-modify-write inside one SQLite transaction. A stored value that does not parse reaches `fn` as null.
   * If the write fails, `fn` runs again on the value still on disk and that result is returned unsaved
   * (lastWriteOk false), so `fn` must be pure: it can run twice.
   */
  update<T>(key: string, fn: (prev: T | null) => T): T {
    let next: T | null = null;
    try {
      store.setItemSync(key, (prev) => {
        let parsed: T | null = null;
        try {
          parsed = prev == null ? null : (JSON.parse(prev) as T);
        } catch {
          parsed = null;
        }
        next = fn(parsed);
        return JSON.stringify(next);
      });
      this.lastWriteOk = true;
    } catch (e) {
      if (__DEV__) console.warn('[kv] update failed', key, e);
      this.lastWriteOk = false;
      next = fn(this.get<T>(key));
    }
    return next as T;
  },
  /** Deletes one key; a failure is ignored. */
  remove(key: string): void {
    try {
      store.removeItemSync(key);
    } catch {
      /* ignore */
    }
  },
  /** Deletes every key in the database (resetAllData); a failure is ignored. */
  clear(): void {
    try {
      store.clearSync();
    } catch {
      /* ignore */
    }
  },
};

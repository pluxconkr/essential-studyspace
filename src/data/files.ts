/**
 * Offline file storage under the app's document directory (never the purgeable cache).
 * Used for downloaded JSON assets. Web gets `files.web.ts`.
 *
 * Files live in `<document>/offline/`; today that is the downloaded venue directory (`venues.json`, written and
 * read by venueRepo). The module also reports free disk space for the low-storage guard and the Offline data
 * screen. Every call is synchronous and none throws: a miss or a failure reads as null / 0 (Infinity for free space).
 */
import { Directory, File, Paths } from 'expo-file-system';

/** The offline folder once offlineDir() has made it; reused for the life of the process. */
let dir: Directory | null = null;

/** The `offline` folder under the document directory, created (with any missing parents) on the first call. */
function offlineDir(): Directory {
  if (!dir) {
    dir = new Directory(Paths.document, 'offline');
    try {
      dir.create({ intermediates: true, idempotent: true });
    } catch {
      /* exists already, or cannot be created: each file call below catches its own error */
    }
  }
  return dir;
}

/** Synchronous JSON files in the offline folder. */
export const files = {
  /** The file parsed from JSON, or null when it is missing, unreadable or not valid JSON. Synchronous, so hydration can use it. */
  readJsonSync<T>(name: string): T | null {
    try {
      const f = new File(offlineDir(), name);
      if (!f.exists) return null;
      return JSON.parse(f.textSync()) as T;
    } catch {
      return null;
    }
  },
  /** Replaces the file with `data` as JSON; returns its size in bytes, or 0 when the write failed (warns in development). */
  writeJson(name: string, data: unknown): number {
    const raw = JSON.stringify(data);
    try {
      const f = new File(offlineDir(), name);
      f.write(raw);
      return f.size;
    } catch (e) {
      if (__DEV__) console.warn('[files] write failed', name, e);
      return 0;
    }
  },
  /** Size of the file in bytes, 0 when it does not exist. */
  bytesOf(name: string): number {
    try {
      const f = new File(offlineDir(), name);
      return f.exists ? f.size : 0;
    } catch {
      return 0;
    }
  },
  /** Deletes the file if it exists; a failure is ignored. */
  remove(name: string): void {
    try {
      const f = new File(offlineDir(), name);
      if (f.exists) f.delete();
    } catch {
      /* ignore */
    }
  },
  /**
   * Free bytes on the device's internal storage, or Infinity when that cannot be read. Callers treat a non-finite
   * value as unknown: no low-space check, no "free on this phone" line, `freeBytes: null` in a storage notice.
   */
  availableBytes(): number {
    try {
      return Paths.availableDiskSpace;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  },
};

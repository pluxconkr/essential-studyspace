/**
 * Web fallback for file storage. Mirrors small JSON blobs into localStorage via the kv module.
 *
 * A "file" is the kv key `file:<name>` (`./kv` resolves to kv.web.ts on web). Sizes are JSON lengths in
 * characters, and free space is reported as unknown (Infinity), so the low-space check never fires on web.
 */
import { kv } from './kv';

/** The kv key that stands in for file `name`. */
const key = (name: string) => `file:${name}`;

/** Same surface as files.ts, backed by kv keys instead of files. */
export const files = {
  /** The stored value for `name`, or null. */
  readJsonSync<T>(name: string): T | null {
    return kv.get<T>(key(name));
  },
  /** Stores `data` under `name` and returns its JSON length as the size, whether or not localStorage accepted it. */
  writeJson(name: string, data: unknown): number {
    kv.set(key(name), data);
    return JSON.stringify(data).length;
  },
  /** JSON length of the stored value, 0 when there is none. */
  bytesOf(name: string): number {
    const v = kv.get<unknown>(key(name));
    return v == null ? 0 : JSON.stringify(v).length;
  },
  /** Deletes the stored value. */
  remove(name: string): void {
    kv.remove(key(name));
  },
  /** Always Infinity: free space is not known synchronously on web, and callers read a non-finite value as unknown. */
  availableBytes(): number {
    return Number.POSITIVE_INFINITY;
  },
};

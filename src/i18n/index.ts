/**
 * Tiny string table: t(key, params) with {name} placeholders and .one/.other plurals.
 * No Expo imports here — this module is shared by the domain layer, tests and the server routes
 * (through the domain code), which all default to English. The app shell sets the device language
 * at boot (see app/_layout.tsx).
 *
 * App text comes from t(), tn() and tlist(). Keys come from en.ts, the source of truth; es.ts must
 * define every one of them, which the type check enforces.
 */
import { en, type Key } from './en';
import { es } from './es';

/** The two app languages. */
export type Locale = 'en' | 'es';
/** Every string key, as defined by en.ts. */
export type { Key };

/** Both dictionaries, by locale. */
const DICTS: Record<Locale, Record<Key, string>> = { en, es };
/** Language of every t() call. Plain module state: changing it re-renders nothing, so it is set once at boot. */
let current: Locale = 'en';

/**
 * Accepts a BCP-47 tag or language code; anything that is not Spanish falls back to English.
 * Returns the locale chosen. The root layout calls it once with the device's first preferred language.
 */
export function setLocale(tag: string | null | undefined): Locale {
  current = tag?.toLowerCase().startsWith('es') ? 'es' : 'en';
  return current;
}

/** The active locale ('en' until setLocale picks Spanish). */
export function locale(): Locale {
  return current;
}

/** The string for `key` in the active language, with every `{name}` replaced by params.name; placeholders without a param stay as written. */
export function t(key: Key, params?: Record<string, string | number>): string {
  let s: string = DICTS[current][key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Keys that exist as a `.one` / `.other` pair (distributive over the key union). */
type PluralKeyOf<K> = K extends `${infer B}.one` ? (`${B}.other` extends Key ? B : never) : never;
/** Base keys tn() accepts, e.g. 'time.hoursAgo' for 'time.hoursAgo.one' / 'time.hoursAgo.other'. */
export type PluralKey = PluralKeyOf<Key>;

/** English-style plural: exactly one vs. everything else. Fills {n} automatically. Spanish splits the same way, so two forms cover both languages. */
export function tn(n: number, key: PluralKey, params?: Record<string, string | number>): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...(params ?? {}) });
}

/** Comma-separated list keys ("Sun,Mon,…") → array. Used for day and month names. */
export function tlist(key: Key): string[] {
  return t(key).split(',');
}

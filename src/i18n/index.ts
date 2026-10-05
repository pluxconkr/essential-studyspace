/**
 * Tiny string table: t(key, params) with {name} placeholders and .one/.other plurals.
 * No Expo imports here — this module is shared by the domain layer, tests and the server route,
 * which all default to English. The app shell sets the device language at boot (see app/_layout.tsx).
 */
import { en, type Key } from './en';
import { es } from './es';

export type Locale = 'en' | 'es';
export type { Key };

const DICTS: Record<Locale, Record<Key, string>> = { en, es };
let current: Locale = 'en';

/** Accepts a BCP-47 tag or language code; anything that is not Spanish falls back to English. */
export function setLocale(tag: string | null | undefined): Locale {
  current = tag?.toLowerCase().startsWith('es') ? 'es' : 'en';
  return current;
}

export function locale(): Locale {
  return current;
}

export function t(key: Key, params?: Record<string, string | number>): string {
  let s: string = DICTS[current][key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Keys that exist as a `.one` / `.other` pair (distributive over the key union). */
type PluralKeyOf<K> = K extends `${infer B}.one` ? (`${B}.other` extends Key ? B : never) : never;
export type PluralKey = PluralKeyOf<Key>;

/** English-style plural: exactly one vs. everything else. Fills {n} automatically. */
export function tn(n: number, key: PluralKey, params?: Record<string, string | number>): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...(params ?? {}) });
}

/** Comma-separated list keys ("Sun,Mon,…") → array. */
export function tlist(key: Key): string[] {
  return t(key).split(',');
}

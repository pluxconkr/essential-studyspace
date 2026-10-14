/**
 * iOS build of `./ion-fallback` (Metro picks `.ios.tsx` over `.tsx` on iOS). iOS renders SF Symbols, so the Ionicons
 * fallback is never mounted and its 390 KB font stays out of the build (docs/perf.md).
 */

/** Stand-in for the Ionicons component under the same name, so icons.tsx imports it unchanged on iOS; renders nothing. */
export function IonFallback(): null {
  return null;
}

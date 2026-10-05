/** iOS renders SF Symbols, so the Ionicons fallback is never mounted and its 390 KB font stays out of the build. */
export function IonFallback(): null {
  return null;
}

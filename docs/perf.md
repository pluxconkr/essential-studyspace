# Performance — baseline and what changed

Measured 2026-10-05 on the iOS export (`CI=1 npx expo export --platform ios`, Expo SDK 57, Hermes, React Compiler on). The sibling app `../nmi-typhoon-watch` was exported the same way for comparison. Byte attribution comes from a `--no-bytecode --source-maps` export of the same code, attributing minified JS bytes to each package through the source map (script kept out of the repo; numbers are approximate to ±2 %).

## Baseline

| Measure | StudySpace | Sibling |
|---|---|---|
| Hermes bundle | 3,416,303 B (1,432 modules) | 3,231,593 B (1,420 modules) |
| Exported assets | 24 files, 412,860 B | 24 files, 412,860 B |
| Largest asset | Ionicons.ttf 389,724 B (94 % of assets) | same |
| expo-doctor | 20 / 21 (missing peer `expo-font`) | — |

Minified JS before bytecode: 2,270,811 B.

| Share of JS | Bytes | Package |
|---|---|---|
| 25.3 % | 574,844 | react-native |
| 20.4 % | 462,293 | expo-router (+ react-navigation) |
| 11.8 % | 267,993 | app code (`src/`): i18n dictionaries 48 K, primitives 24 K, spot 19 K, offline data 14 K, focus 11 K |
| 4.6 % | 104,264 | react-native-svg (maps, curves, timer ring) |
| 4.3 % | 97,253 | expo |
| 2.9 % | 64,967 | react-native-screens |
| 2.7 % | 62,426 | the four map JSONs (`assets/data/maps`) |
| 2.2 % | 49,431 | @react-native/virtualized-lists |
| 1.5 % | 33,387 | expo-notifications |
| 1.2 % | 26,721 | expo-sqlite |

Reading: the app's own code is an eighth of the bundle; the difference to the sibling is the map data plus the larger screens. The one avoidable item is the Ionicons font: iOS renders SF Symbols through `expo-symbols`, but `src/ui/icons.tsx` imported Ionicons at module scope, so Metro packed the font into the iOS export (the sibling has the same cost).

Timers before: every `useNow()` / `useRealNow()` call owned a `setInterval` and a state cell (13 call sites across screens and derived hooks), so the Now tab ran four intervals and the ranking recomputed twice per 30 s on two different clocks.

## What changed (2026-10-05)

Findings that failed review are listed afterwards so they are not re-opened.

| Change | Before | After |
|---|---|---|
| Ionicons stays out of the iOS build: `src/ui/ion-fallback.ios.tsx` resolves instead of the Ionicons re-export, since iOS always draws SF Symbols (`expo-symbols` never mounts the fallback) | assets 24 files, 412,860 B; Hermes bundle 3,416,303 B, 1,432 modules | 23 files, 23,136 B; 3,359,600 B, 1,412 modules |
| Tabs mount on first visit (`lazy: false` removed from `src/app/(tabs)/_layout.tsx`) | Map (661 SVG nodes) and Focus were built before the first frame | built when the tab is opened |
| `AreaMap` is compiled by the React Compiler (a destructuring `for..of` made the compiler skip the component) | every Map render reconciled 555 paths and 31 labels | base layers memoised; a tick re-renders pins only |
| Check-in screen is compiled by the React Compiler (the lint suppression that made the compiler skip it is gone; the effect reads the store directly) | 30 s on the screen: 78 cell and 30 level-bar renders; a keystroke re-rendered 13 cells | 0 cell renders per tick; a keystroke re-renders the two buttons |
| `weekSummary` compares epochs before calling Intl | 2,001 `formatToParts` calls per tick at the 2,000-entry log cap | 3 |
| `zonedParts` memoised per minute (parts carry no seconds) | 481–557 `formatToParts` calls per ranking tick for about 50 distinct minutes | 49 on the first tick, 0 on the next tick in the same minute |
| Refresh stamp means "a network attempt started now" | an offline no-op stamped `lastRefreshAt`, the reconnect refresh was skipped, and the stamp at the end of the run made the 5-minute interval fire every 10 minutes | two tests in `__tests__/refresh.test.ts` |
| The relay keeps a re-sent report once | a lost POST response made the phone re-send the same body; two copies gave other phones "high" confidence from one person | byte-identical retry is recognised (`__tests__/crowd-api.test.ts`) |
| `expo-font` declared | expo-doctor 20 / 21 | 21 / 21 |
| Section headers wrap their right-hand note at large text sizes | "HOURS" ran into "OPENS MON 8:00 AM" at accessibility sizes | note drops under the title, right-aligned |

Everything above kept tsc, lint and the jest suite green and was re-shot on the simulator (Now, Map, Focus, Spot, and Spot at accessibility-large).

After the anti-slop pass that followed (dead code, unused props and tokens, duplicated helpers removed): Hermes bundle 3,339,034 B, 1,413 modules; assets unchanged at 23 files, 23,136 B.

### Investigated and left alone

- One `setInterval` per `useNow`/`useRealNow` consumer: a shared ticker would cut timers to one per rate but not reduce renders; timers are cheap.
- The Focus tab's 1-second tick re-rendering the session subtree: measured small; the ring must tick anyway.
- Serial upload of unsynced check-ins before the crowd GET, full re-download of the optional venue feed, and rewriting the crowd snapshot when unchanged: real but rarely hit and not worth the diff.
- The four map JSONs resident in memory (about 64 KB): not measurable.
- `t()` lookups, ScrollView for at most 19 rows, hydrate's JSON.parse (0.4 ms for a full 2,000-entry log), splash and icon assets, Intl formatter construction (one module-level formatter): no cost found.

### Rejected after a device check

Removing the root remount on a Dynamic Type change (`<Stack key={fontScale}>` in `src/app/_layout.tsx`). The profiling pass argued that Fabric re-measures mounted text natively. On the simulator (Expo Go, SDK 57) it does not: with the key removed, already-mounted Spot and Map screens kept their old text measurements and clipped every line until remounted. The remount stays; it only runs when the user changes the text size.

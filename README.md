# StudySpace

Find a seat, study nearby. A local-first study-logistics app for New Jersey students. Congressional App Challenge 2026 · NJ.

**One claim.** The daily question is not "where is a library" but "is there a seat there right now, and will there be one when my train gets me there." Campuses do not answer it; students answer it with a group chat and a wasted 25-minute walk. StudySpace answers it with real published hours, honest crowd levels (student check-ins fused with a labelled typical pattern), walking minutes from the station, and a one-person study timer — and it keeps working with no signal, because a commuter in a basement stack has none.

## What it does (v1 — "find a seat")

| Tab / screen | What it shows | Offline? |
|---|---|---|
| **Now** (home) | Your free block today, spots ranked by seats-at-arrival × walk × stays-open × noise × amenities, level now and level when you arrive, closing-soon and open-past-midnight callouts, your week. | Yes — hours and the typical pattern never need a signal |
| Spot | Level with its honesty line ("2 reports agree · newest 3 min ago" / "Typical pattern · no live reports"), today's hours with exceptions (e.g. a renovation closure), the whole week, a typical-day curve, zones and their noise policy, walk from the station with the formula, accessibility, a watch toggle, your own check-ins, and every source. Hours whose typical level comes from student reports are underlined; the rest is a labelled estimate. | Yes |
| Check-in | ONE tap is a complete check-in. Optional zone, noise, what is available, a private note. Presence is a distance from GPS, read once and discarded. Without a fix you can say "I'm not at the spot" (counted lightly, labelled, replaced by any check-in from the spot). "Earlier visit" reports a day, hour and level from the last 7 days and feeds only the typical pattern. | Yes — queued and shared later if sharing is on |
| Why this ranking? | The five-term score, the fusion weights, the bucket boundaries, the confidence rules and the walking formula, with this spot's numbers filled in. | Yes |
| **Map** | Offline vector maps of New Brunswick, Newark, Hoboken and Princeton (OpenStreetMap lines bundled in the app), pins numbered by level, stations, your GPS dot. | Yes — zero network requests on this screen |
| **Focus** | A one-person study table: 25/5 × 4, 50/10 × 3, 90/15 × 2 or free; declared goals; pause, skip, end. Absolute timestamps, so a locked phone rejoins at the right block. Block changes arrive as local notifications. | Yes |
| Your week | Streak, focused time, goal rate, focus by hour of day, where you focus. Student-owned, exportable, never shared. | Yes |
| Offline data | What is saved, how big, and when. Refresh, sharing and notification toggles, demo scenarios, data licences, export, reset. | Yes |

Not in v1 (on purpose, and in the spec's own sequencing): shared study tables, buddy matching, boards, events, venue console, deals, the room-scan vision model, under-18 accounts. "Tables at low density are empty rooms, and empty rooms teach users the app is dead." Crowd data works at day one with a single user, so it ships first.

## Where the AI is (and is not)

- **Nowhere in v1.** Every number can explain itself on the "Why this ranking?" screen. Crowd level is a weighted fusion (`src/domain/levels.ts`): each report weighs `0.45 × proof (0.4–1.0) × ½^(age ÷ 25 min)`, the typical-pattern prior weighs `0.03`; the share is bucketed into five levels; confidence comes from how many fresh reports agree. Ranking is five weighted terms (`src/domain/ranking.ts`). Walking time is `metres × 1.3 ÷ 80` (`src/domain/transit.ts`). Hours are a table with an exception calendar (`src/domain/hours.ts`). The typical-day curves are per-kind estimates (`src/domain/curve.ts`) and say so on every screen they touch. The typical-day baseline is learned from student reports by one rule: an hour switches from the estimate to the students' weighted mean once it holds at least 5 reports from at least 3 distinct days (`PATTERN_MIN` in `src/domain/curve.ts`).
- **Why not.** The spec's own view: "the seat-count vision model is the most over-promisable piece … if accuracy is poor, ship without it — one-tap check-ins already work." And: "a student who travels 25 minutes on a wrong Chill does not report the bug, they delete the app." Under-promising is cheap; a model that cannot show its arithmetic is not.
- **Where it would go later.** Forecasting (per-zone quantile models once ≥ 2 weeks of real check-ins exist) and weekly clustering of check-in notes (k ≥ 5 before anything is shown). Both are batch jobs with deterministic publishing rules, not anything on the phone.

## Where the server is (and is not)

- **Two routes, one store:** `src/app/api/crowd+api.ts` (`POST` a report; `GET` the last three hours per venue) and `src/app/api/pattern+api.ts` (`GET` the learned baseline), both over `src/server/crowdStore.ts`. Reports come in three kinds: `live` (at the spot; weight = presence proof), `remote` (not at the spot; fixed low weight, shown as such, ignored once anyone at the spot reports) and `past` (an earlier visit; baseline only, never "right now"). The baseline is kept as per-venue monthly aggregates — count, weighted sum and distinct days per day type and hour, 120-day expiry — so no raw report is retained for it. The routes accept no notes, no identities, no coordinates: what is not collected cannot leak. Storage is an Upstash-compatible Redis (REST, pipelined) when `CROWD_STORE_URL`/`CROWD_STORE_TOKEN` are set, else the dev-server memory (gone on restart; the app says "dev relay"). Fusion happens on the phone with the same domain code, so the routes are dumb, replaceable pipes. Rate-limited per IP.
- **Nowhere else.** No accounts, no login, no analytics. The phone holds a key for nothing.

External APIs: 0 · API keys needed by the phone: 0 · Server functions: 2 (one store).

## Stack

Expo SDK 57 · expo-router · React Native 0.86 · TypeScript. Local storage is `expo-sqlite/kv-store` (synchronous reads, so the first frame renders from disk) plus `expo-file-system` for a downloaded directory; web falls back to localStorage. Map: `react-native-svg` drawing simplified OSM lines (≈ 140 KB for four areas) — no tiles, no map SDK, no API key. Clock: `America/New_York` via Intl, so library hours are library time whatever the phone is set to. Local notifications for block changes and watched spots. English and Spanish follow the device language (`src/i18n`); every string in the app goes through one dictionary.

Same design system as the sibling project `nmi-typhoon-watch`: native iOS grouped-list idiom, one accent, three semantic colours (navy information · red Packed/Full · green Empty/Chill; amber for Filling, closing soon and stale data), no shadows, 44 pt targets, body ≥ 15 pt, tabular numerals, no spinners, every cached thing time-stamped, demo data labelled wherever it appears.

## Run it

```bash
npm install
cp .env.example .env.local  # optional: CROWD_STORE_URL/TOKEN for a persistent relay (docs/backend-setup.md)
npx expo start              # press i / a / w
```

Everything works in Expo Go. The relay works out of the box on the Metro dev server (in-memory): two phones on the same network see each other's check-ins. For local notifications with a custom channel, build a development client (`npx expo run:ios` / `npx expo run:android`).

## Verify

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # jest: levels & fusion, hours & time zone (DST), ranking, timer, focus stats, bundled data, crowd relay, storage guard, refresh policy, Phase 1 gaps, i18n dictionaries, screen smoke tests (zero network)
npx expo-doctor     # 21/21
```

Manual acceptance procedures T1–T10, the six-state matrix and the demo script are in [docs/QA.md](docs/QA.md).

## Build, deploy, release

Identifiers: iOS `com.27363.studyspace`, Android `com.tstst.studyspace` (see `app.json`). Profiles live in `eas.json`. Commands below use EAS CLI 16 or newer (`npm i -g eas-cli`).

**1. Deploy the relay and set the three environment values:** [docs/backend-setup.md](docs/backend-setup.md). Repeat the `eas env:set` lines with `--environment preview` and `--environment development` for those profiles. Optional directory feed (JSON shaped like `assets/data/venues.json`):

```sh
eas env:set --name EXPO_PUBLIC_VENUES_URL --value https://<host>/nj-study-spots.json --environment production --visibility plaintext
```

**2. Builds**

```sh
eas build --profile development --platform ios            # dev build for a real iPhone (notifications, T1–T10)
eas build --profile development-simulator --platform ios  # same, for the iOS Simulator
eas build --profile preview --platform android            # installable APK
eas build --profile production --platform all             # store builds, version auto-incremented
eas submit --profile production --platform ios            # TestFlight / App Store
eas submit --profile production --platform android        # Play Console
```

## Demo scenarios

Offline data → **Demo & testing** → Live / Finals / Quiet / Late night. A scenario shifts the app clock (3 PM, 9:30 AM or 11:35 PM on a weekday) and injects simulated reports so the ranking, the closing-soon logic and the finals exception can be shown at any time of day. Demo reports are labelled wherever they appear and are never uploaded. "Simulate no signal" shows the OFFLINE banner and blocks all network calls; the real test is airplane mode.

Deep links for every scenario, area and spot: [docs/QA.md § Deep links](docs/QA.md#deep-links).

## Data and licences

- Hours: published schedules of Rutgers University Libraries (LibCal), NJIT Library, Stevens Library, New Brunswick Free Public Library, Newark Public Library, Hoboken Public Library (incl. the 2026 renovation closure) and Princeton Public Library, read 3 Oct 2026; café hours from a public listing. Evidence trail per venue in [docs/venue-sources.md](docs/venue-sources.md). Seat counts are not published by any venue and are not invented.
- Coordinates and map lines: © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright. The simplified lines in `assets/data/maps/` are derivative databases and stay under ODbL.
- Transit modes: NJ Transit, PATH and Amtrak public system maps.
- Typical-day curves: per-kind estimates (`src/domain/curve.ts`), labelled "estimate" everywhere; they are the cold-start prior the spec calls for, not data. Once students' reports reach the threshold for an hour, that hour shows their data and says so.
- Venue names are real institutions used because students study there. No partnership, endorsement or data relationship is implied.

## Project layout

```
src/app/            expo-router screens (+ api/crowd+api.ts and api/pattern+api.ts server routes)
src/server/         relay storage: the 3-hour live list and the learned-baseline aggregates (memory or Upstash Redis REST)
src/domain/         pure logic: types, time zone, hours & exceptions, typical curves, level fusion & confidence, ranking, transit, timer, focus stats, free blocks
src/data/           local storage (kv + files, with .web.ts fallbacks), repositories, bundled map data
src/services/       network state, crowd relay client (reports + learned baseline), refresh orchestration, notifications, GPS, demo scenarios
src/store/          useSyncExternalStore app store + derived hooks (live levels, ranking, session, stats)
src/ui/             theme tokens, icons, primitives, level & session widgets, SVG area map
src/i18n/           English and Spanish dictionaries, t()/tn() helpers (device language at boot)
assets/data/        bundled directory (19 venues), stations, four area maps
assets/locales/     iOS display name and permission strings per language
__tests__/          unit + screen smoke tests (jest-expo)
docs/QA.md          acceptance procedures T1–T10, state matrix, demo script
docs/venue-sources.md  where every hour and coordinate came from
docs/backend-setup.md  the three values to supply and how to verify each step
docs/perf.md        bundle, render and startup baseline, what changed and what was left alone
docs/design.md      design direction, type scale, component rules, audit
docs/gap-analysis.md  spec vs app, item by item
```

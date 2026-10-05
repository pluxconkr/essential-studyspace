# Gap analysis — shipped app vs. the spec

Spec: `../docs/2_NewJersey_1.HTM` (StudySpace prototype v0.9, Spec & Handoff tab). Scope of this comparison is the spec's **Phase 1 "find a seat"** cut (§16) plus the non-functional (§12) and safety (§13) requirements that apply to a student app with no accounts. Phase 2/3 items are listed only where the spec marks them MVP so the deferral is explicit.

Status key: **done** · **partial** (works, but a named piece is missing) · **missing** · **n/a** (does not apply to a local-first v1 without accounts or a venue console) · **out of scope** (a different surface: web console, server ML).
Decision key: **G004** (fixed in the design pass) · **G005** (built in this run) · **defer** (next run, with reason) · **no** (will not build, with reason).

## §16 Phase 1 — "find a seat"

| Spec item | Status | Evidence | Decision |
|---|---|---|---|
| Venue directory with real hours | done | `assets/data/venues.json` — 17 venues, hours from LibCal / library sites, exception calendar (`src/domain/hours.ts`), sources in `docs/venue-sources.md` | **G005**: add the two New Brunswick branch libraries left out (Chang, Math & Physics — LibCal Mon–Fri 9–5) so the College Ave / Cook / Busch set is complete |
| One-tap check-in with presence proof | partial | `src/app/checkin/[id].tsx`; proof = GPS distance → weight (`proofStrength` in `src/domain/levels.ts`). Missing: wifi BSSID hash (iOS does not expose BSSID to apps), dwell ≥ 8 min (needs background location), explicit check-out | **no** for BSSID (platform); **defer** dwell and check-out (both need background location; recency decay already retires a report in ~25 min) |
| Five-level display with honest confidence | done | `fuse`, `confidenceText`, `levelText` in `src/domain/levels.ts`; ranges when low confidence; never a percentage outside "Show the arithmetic" | — |
| Map | partial | `src/ui/AreaMap.tsx` — offline OSM lines, pins by level, stations, GPS dot. Missing from S2: predicted-crowding heat layer, late-night layer | **G005**: "Open late" filter (dims spots closing before 11 PM); **no** heat layer (a per-pin level already encodes the same number; heat needs zone geometry we do not have) |
| Spot detail with zones | done | `src/app/spot/[id].tsx` — level + confidence, typical day with arrival marker, zones with noise policy, amenities, transit, accessibility, watch, own check-ins, sources | S3 "student notes" need k ≥ 5 corroboration and a notes relay → **defer** (Phase 2 relay feature); "tables here, deal" → Phase 2 |
| Watches and notifications | partial | `actions.toggleWatch`, `watchHits` + `notifyWatchHits` in `src/services/refresh.ts` / `notifications.ts` — fires only on a foreground refresh | **G005**: background poll for watched spots (`expo-background-task`, same pattern as the sibling's `backgroundPoll.ts`) |
| Minimal profile | partial | `src/app/profile.tsx` — streak, focused time, goal rate, hour-of-day curve, where you focus. Missing from S14: subject split (needs subject tags on sessions), reliability bands (needs tables) | **defer** both to Phase 2 with tables (subjects and reliability are table concepts) |
| Console: live overview, spaces/hours, data quality | out of scope | web product; the relay `GET /api/crowd` already returns what a console would read | **no** in this repo |

## §3 Screen inventory (MVP = Yes rows)

| Screen | Status | Evidence / gap | Decision |
|---|---|---|---|
| S1 Now | done | `src/app/(tabs)/index.tsx`: free block, ranked spots with level now + at arrival, closing-soon, your week. "Tables starting, events" are Phase 2 | — |
| S2 Map | partial | see above | **G005** late layer |
| S3 Spot detail | done | see above | — |
| S5 Check-in | done | level, noise, availability, note, share toggle. "Visibility choice" (initials / full / invisible) has no meaning without other users | **n/a** until Phase 2 |
| S6/S7/S9 Tables browse / detail / host | n/a | spec §16 says no tables in Phase 1; §4.3 lifecycle is Phase 2 | **defer** (Phase 2) |
| S8 Live focus room | done (solo) | `src/app/(tabs)/focus.tsx` + `src/domain/timer.ts`: ring, goals, blocks, absolute timestamps, pause/skip, notifications. Roster/chat are table features | roster/chat → Phase 2 |
| S14 Profile | partial | see above | **defer** subject split |
| S15 Safety & visibility | missing | privacy facts are scattered (check-in presence row, Offline data footer); there is no one screen that states what leaves the phone | **G005**: `privacy.tsx` — location, check-ins, focus log, notifications, export/delete — each line grounded in actual code behaviour; linked from Profile › Settings |

Out-of-scope list (§3) and refused revenue (§15): the app has no tutoring, notes sharing, feed, follower graph, photos, paid reservations or money between students. **Compliant.**

## §4 Core flows

| Step | Status | Gap | Decision |
|---|---|---|---|
| 4.1 home shows next free block + ranked spots | done | — | — |
| 4.1 ranking = f(level at arrival, walk, open until, noise, outlets, deal) | done | "deal" has no v1 meaning | — |
| 4.1 each card: level now + at arrival + confidence | partial | rows show both levels and the range bars; the words "2 reports agree" appear only on the spot page | **no** — a third line per row was the thing the design pass removed; the range bars carry confidence |
| 4.1 tap "go" → arrival reminder + auto check-in prompt on geofence | missing | no geofencing | **G005** foreground variant: when the app is in the foreground within 75 m of a spot and has no check-in there in the last 30 min, the Now tab offers a one-tap "You're at X — how is it?" card. Geofence/background reminder → **defer** (background-location permission is a heavy ask for v1) |
| 4.2 one tap = complete check-in; extras optional | done | — | — |
| 4.2 presence proof GPS + BSSID + dwell | partial | GPS only | see above |
| 4.2 weight = f(reporter accuracy, proof, recency) | partial | proof × recency; reporter accuracy needs an identity the relay deliberately does not have | **n/a** by privacy design; document |
| 4.2 contradicts the sensor by > 2 levels → hold | n/a | no sensors in v1 | — |
| 4.2 points: diminishing, no prizes | missing | — | **defer**: points are a growth mechanic for the social phase; the profile already counts check-ins |

## §12 Non-functional

| Requirement | Status | Evidence / gap | Decision |
|---|---|---|---|
| Home renders usable content < 1.2 s, cached levels first | done (unmeasured) | synchronous hydration from SQLite before first render (`src/store/appStore.ts`) | **G006**: measure cold start on the simulator and record |
| Offline: check-ins queue locally, timers on absolute timestamps | done | `synced` flag + `syncCheckIns`; `blockAt` | — |
| Battery: no continuous GPS | done | one-shot `acquireLocation` | background poll in G005 is a 15-min OS-scheduled task, not GPS |
| Accessibility: WCAG 2.2 AA, screen reader, dynamic type to 200 %, never colour-alone | partial | labels on controls; bars + label for levels; `maxFontSizeMultiplier` only on some texts; SF Symbol glyph names leak into VoiceOver ("duration, No free block…") | **G004**: hide decorative icons from the accessibility tree; audit type scaling on every screen |
| Multilingual: EN + ES at launch | missing | all copy is English literals | **G005** (last item, after the copy freeze in G004): `src/i18n` with `t()`, device locale via `expo-localization`, Spanish for every student-facing string; venue data stays as published |
| Scale, availability, 99.9 % reads | n/a | relay is stateless; the app degrades to hours + typical pattern with time stamps | — |
| Retention: proof data 30 d, focus logs until deleted, frames never stored | done | `CHECKIN_RETENTION_DAYS = 30`; focus log student-owned; no camera | — |
| Procurement (VPAT, DPA, FERPA, SSO) | n/a | no institutional deal in v1 | — |

## §13 Safety, privacy & minors (v1-relevant rows)

| Risk | Status | Evidence / gap | Decision |
|---|---|---|---|
| Find and follow a person | done | relay stores venue, zone, level, minute-rounded time; no identity, no trail, no live location | — |
| Stranger meetings | n/a | no social features in v1 | — |
| Minors mixed with adults | n/a | no accounts, no contact between users; nothing a minor could be exposed to | revisit at Phase 2 |
| Focus data used against students | done | local only; export/delete from Offline data | — |
| Venue data reveals individuals | partial | relay returns individual anonymous reports rather than k ≥ 5 aggregates; a one-person zone at 2 a.m. is theoretically re-identifiable | **defer**: aggregate per 15-min bucket server-side once there is real traffic; document |
| Late-night physical safety | missing | spec: show staffed desk + campus escort number after 9 PM | **G005** if numbers can be verified from official pages (Rutgers RUPD / Knight Mover, NJIT, Stevens campus police); otherwise defer |
| Crowd data used by non-students | done | public venue levels are public anyway | — |

## §17 Metrics and §19 backlog items that touch the phone

| Item | Status | Decision |
|---|---|---|
| Wasted-trip rate — "arrived, level was 2+ worse than shown" (E12: the honesty metric) | missing | **G005**: store the level that was shown when a check-in is posted; Profile reports "N of M check-ins within one level of what was shown" — local, no analytics |
| E2 exception calendar, amenities, transit distances, accessibility fields | done | — |
| E3 check-out, points | missing | defer (above) |
| E4 config-driven weights, log every input | done | `FUSION` config; every report kept 30 d locally | — |
| E5 level at arrival | done | `predictAt` | — |
| E6 forecast models | partial (typical curve + arrival drift) | **defer** per spec: "ship after two weeks of real check-ins" |
| E10 GTFS walk times, LibCal hours feed | partial (straight-line × 1.3; hours static per term) | **defer**: `EXPO_PUBLIC_VENUES_URL` already lets a hosted directory replace the bundle without an app update |
| E11 accessible-seat tracking | partial | zones carry `accessibleSeats`? — no field in the data yet | **G005**: add `accessibleSeats` to `Zone` (null where unpublished) and show it; never counted as general capacity |

## Independent cross-check (read-only analyst pass)

A second, independent read of spec vs. code found defects the table above missed. Verified against the code and accepted:

| Finding | Where | Decision |
|---|---|---|
| A synced own check-in is fused twice (local copy + relay copy), so one person can show "2 reports agree" at high confidence | `src/store/derived.ts` `useLiveLevels`, `src/services/refresh.ts` `watchHits` | **G005**: de-duplicate own synced reports against relay rows (same venue, zone, level, minute) |
| One unverified (no-GPS) report is published as *medium*; spec §7 says a single unverified check-in is *low · unverified* | `fuse` in `src/domain/levels.ts` | **G005**: medium needs one strong (≥ 0.65 proof) recent report or two of any weight |
| Reports 90–180 min old still move the level while the label reads "no live reports" | same | **G005**: 90–180 min → *low*, "last report 2 h ago · unverified"; *none* only when there is no report at all |
| Home cards show typical-pattern levels in the same colours as live ones | `src/app/(tabs)/index.tsx`, `LevelBars` | **G004**: fade bars when confidence is none/low; status line says "no reports yet · typical pattern" when the area has none |
| Zones are static labels; reports carry `zoneId` but fusion ignores it (spec S3: "4F silent is full, 2F is chill") | `fuse`, spot Zones section | **G005**: per-zone level + honesty line when a zone has reports; check-in zone picker already exists |
| Noise and amenity answers are stored but never shown or shared | check-in, relay schema | **G005**: relay accepts `noise`/`amenities`; spot shows the newest report's noise and what was available |
| Last precise GPS fix is persisted to disk while the UI says it is discarded | `locationRepo` in `src/data/repos.ts` | **G005**: stop persisting; keep the fix in memory only |
| Watches never evaluate against the in-memory dev relay (`crowd === 'ok'` only) and can fire on your own report | `refreshAll`, `watchHits` | **G005**: evaluate on `ok` and `not-configured`; exclude own reports |
| No refresh while the app stays in the foreground (levels age silently) | `refreshIfStale` only on foreground/online events | **G005**: 5-minute foreground interval |
| A check-in queued offline for > 3 h gets 422 from the relay and stays "not shared yet" forever | `syncCheckIns` | **G005**: treat 422 as terminal (mark synced) |
| `studyspace://?demo=…` works in production builds and persists a shifted clock | `index.tsx` deep-link effect | **G005**: honour demo deep links only in `__DEV__`; Offline data controls stay |
| Per-IP relay limit (20 posts / 10 min) throttles a whole library behind campus NAT | `src/app/api/crowd+api.ts` | **G005**: raise to 300 / 10 min per IP (still blocks a single script) |
| Session notification says "Chat opens now" although no chat exists | `src/services/notifications.ts` | **G004** copy fix |
| "Check in where I am" with location off silently picks the top-ranked spot | `index.tsx` | **G005**: check-in page gets a "Not here? Pick another spot" row |
| Why screen prints "N% of a busy day" | behind "Show the arithmetic" | keep — it is the one place the arithmetic is meant to be visible; the home, map and spot never print a percentage |
| Relay trusts the proof weight the client sends | relay POST | accepted for v1 (no identity to anchor a server-side check); clamp stays 0.4–1.0 |
| Relay keeps reports 3 h, so no occupancy history accrues for E6 | relay | accepted for v1 privacy; the right E6 input is a 15-min aggregated history, not individual rows |
| Students-only venues' zone detail is visible without SSO (spec §13) | spot | accepted deviation: the same detail is on the libraries' public pages |
| Console V1/V2/V4 are in Phase 1 per §16 | — | **defer, explicitly**: a venue-staff web console is a separate product surface with its own users and auth; the relay already exposes what it would read. Flagged for the owner's decision |
| 15 % weekly-use gate (§16) cannot be measured without telemetry | — | accepted: no analytics by design in v1; the wasted-trip metric (G005) is the one honesty number kept on the phone |

## Decisions for this run (G005 work list, in order)

1. Correctness of the level itself: de-duplicate own synced reports; unverified → low; 90–180 min → low "unverified"; tests for each.
2. Watches: evaluate on `ok` and `not-configured`, exclude own reports; 5-minute foreground refresh; 422 → terminal for queued check-ins.
3. Per-zone levels on the spot page from zone-tagged reports; relay carries noise + amenities and the spot shows the newest.
4. Stop persisting the GPS fix (copy now matches behaviour).
5. Demo deep links only in development builds; relay POST limit 300 / 10 min per IP.
6. Add Chang Library and Math & Physics Library (data + geocode + sources).
7. Map "Open late" filter.
8. Foreground arrival prompt on the Now tab (75 m, 30-min debounce); "Not here? Pick another spot" row on check-in.
9. Background poll for watched spots (`expo-background-task` + `expo-task-manager`).
10. Privacy & data screen (S15), linked from Profile › Settings.
11. Wasted-trip honesty metric: `shownLevel` on check-ins, reported in Profile.
12. `accessibleSeats` on zones (null where unpublished).
13. Late-night campus safety numbers on spots open after 9 PM — verified: Rutgers RUPD non-emergency / escort 732-932-7211 and Knight Mover 732-932-7433; NJIT Public Safety (973) 596-3120; Stevens Campus Police 201-216-5105.
14. EN + ES localisation of all student-facing strings.

Deferred with reasons: BSSID (platform), dwell/check-out and geofence reminders (background location), points (social phase), subject split and reliability (tables), notes with k ≥ 5 (relay feature), server-side aggregation (needs traffic), learned forecasts (needs data), live LibCal feed (static per term is correct today), venue console (separate surface — owner's call), age band/verification (no social surface in v1).

# Student crowd reports — design (2026-10-10)

Approved in chat on 2026-10-10. Goal: let students report crowdedness even where no presence-proven check-in exists, accumulate those reports per venue so the typical-day baseline is learned from students instead of hand-estimated, and keep presence-proven check-ins as the only source of "right now" confidence.

## 1. Report kinds and the relay

One body, one new field: `kind`.

| kind | Meaning | `at` | Weight | Stored where |
|---|---|---|---|---|
| `live` (default) | at the spot now | now | proof strength 0.4–1.0 (unchanged) | 3-hour live list + aggregates |
| `remote` | now, not at the spot | now | forced to 0.25 by the server | 3-hour live list (with `kind`) + aggregates |
| `past` | an earlier visit | chosen hour within the last 7 days | forced to 0.5 by the server | aggregates only, never the live list |

Validation: `live`/`remote` keep the existing window (not older than 3 h, not more than 5 min ahead); `past` must satisfy now − 7 d ≤ at ≤ now. Rate limit unchanged (300 posts / 10 min / IP). The duplicate guard (byte-identical body kept once) still applies to the live list.

Aggregates: per venue, per month of the report's local (America/New_York) date, per day type (`wk` Mon–Fri, `sa`, `su`), per local hour 0–23. Each bucket stores `n` (count), `s` (Σ weight × level-midpoint pct), `w` (Σ weight) and `d` (distinct local dates, maintained with a per-bucket date set so one day of spam cannot reach the threshold). Raw reports are not retained. Month keys expire after 120 days; reads merge the three most recent months.

Redis: hash `pattern:{venueId}:{YYYY-MM}` with fields `n:{dt}:{h}`, `s:{dt}:{h}`, `w:{dt}:{h}`, `d:{dt}:{h}` (HINCRBY / HINCRBYFLOAT) and set `pattern:{venueId}:{YYYY-MM}:days:{dt}:{h}` (SADD → when it returns 1, HINCRBY d). Commands for one request go through the Upstash `/pipeline` endpoint. Memory store mirrors the same structure.

`GET /api/pattern?venues=a,b` → `{ ok, months: [..3], patterns: { [venueId]: { wk: Bucket[24], sa: Bucket[24], su: Bucket[24] } } }` with `Bucket = { n, days, pct | null }` (`pct = s / w`). `Cache-Control: max-age=3600`. About 40 KB for all 19 venues.

`GET /api/crowd` live reports gain `kind` (absent = `live`).

## 2. Fusion and honesty

- `fuse()` uses `remote` reports (0.25 weight) only while no live report exists in the 3-hour window; the moment someone at the spot reports, remote reports are left out entirely. Remote reports never count toward confidence (fresh, recent, strong), so remote-only evidence yields confidence `low` and the honesty line says so: "1 report · not at the spot".
- `past` reports never enter `fuse()`.
- Learned baseline: `typicalPct(venue, at, phase, pattern)` returns the learned bucket pct when the bucket for (day type of `at`, local hour of `at`) has `n ≥ 5` and `days ≥ 3` (`PATTERN_MIN`, one constant). Otherwise the current estimate (per-kind curve × term multiplier, or the venue-declared curve). Learned values take no term multiplier.
- `LiveLevel.prior` gains the value `'reports'`; the honesty line distinguishes "Typical pattern · from student reports" from "estimate". Arrival predictions use the same function, so they learn too.
- "Why this ranking?" shows one line for the baseline: "This hour: 12 student reports over 5 days → Filling" or "Estimate for libraries".
- Privacy unchanged: no identity, no coordinates, no notes leave the phone; a past report carries one past hour.

## 3. Client flows

- Check-in screen: when presence is not confirmed (no fix, or more than 300 m away) the presence group gets a toggle "I'm not at the spot" (hint: "Counts a little and is shown as a report from elsewhere"). On: the check-in posts `kind: 'remote'`, the primary button reads "Post report", the local record is kept with `kind`.
- Earlier visit: new screen `report/[id]`, reached from the spot page under the typical-day chart ("Were you here earlier? Add what you saw"). Day list (Today, Yesterday, then the five earlier days by weekday name), hour list (the venue's open hours on that day), the five level rows, optional zone. Posts `kind: 'past'` with `at` = the chosen hour's start; offline → queued and synced like check-ins. Footer: "Shapes the typical pattern only; never shown as right now."
- Spot page: the typical-day chart marks hours whose baseline is learned (a 2 pt underline under the bar, legend "▁ student reports") with the footer "N underlined hours come from M student reports; the rest is an estimate." The level hero's honesty line and the reported-details line show "not at the spot" for remote evidence.
- Now tab rows: unchanged layout; honesty wording follows the level.
- Profile: "Crowd check-ins" counts all kinds; the wasted-trip metric uses `live` only.
- Your check-ins (spot page): remote and past rows are labelled.
- Offline data: new row "Typical patterns · 19 spots · size · updated …" (cache key `pattern`).
- Privacy screen: one line: "Earlier-visit and not-at-the-spot reports carry no location."
- Every new string in EN and ES.

## 4. Offline and cache

- `patternRepo` (kv key `pattern`) + `cacheMeta.pattern`. `refreshAll` fetches `/api/pattern` alongside the crowd fetch when the cache is missing or older than 6 hours; it is one more progress step. No bundled pattern: until the first download every hour is an estimate.
- Storage guard order: drop the pattern cache first, then the crowd cache, then trim check-ins.
- `CheckIn.kind` defaults to `live` for records saved before this change (sanitised on read).

## 5. Testing

- Relay: kind validation and forced weights; past accepted within 7 days and absent from the live list; aggregates (n, s, w, d) and the distinct-day rule; `/api/pattern` shape and month merge; memory and Redis (REST stub) paths; the duplicate guard with kinds.
- Domain: learned threshold on/off; fuse remote weight and confidence cap; explain strings; dedupe with kinds; wasted-trip exclusion.
- Client: pattern refresh cadence and storage-guard order; check-in posts the right kind; report screen posts `past`; spot chart markers; offline-data row; EN/ES parity (existing test).
- Simulator: check-in with "not at the spot", an earlier-visit report, the spot chart after a pattern download from the dev relay.

## Out of scope

Forecast models, per-zone learned curves, a venue console, moderation tools. The aggregates are the input a later batch model would consume.

## Implementation notes (2026-10-10)

- The pattern route's URL is derived from the crowd route's (`…/crowd` → `…/pattern`); no new environment variable.
- The earlier-visit screen lists a day's open hours up to midnight; a closing time past midnight is not listable for that day.
- With "I'm not at the spot" on, the check-in's primary button reads "Post report" and the "post and start a session here" button is hidden.
- Earlier-visit reports are de-duplicated on the relay by a 3-hour seen-set keyed by the phone's random per-report id (the body when an old client sends none), so a re-sent request after a lost response counts once while identical reports from different students all count.
- The check-in screen also offers the earlier-visit row (push, so a half-filled check-in survives going back).
- Own earlier-visit reports never enter the phone's own live fusion, zone rows or echo de-duplication; the arrival prompt is debounced only by check-ins made at the spot; watches never fire on remote-only evidence.

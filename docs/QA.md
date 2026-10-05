# Acceptance tests (T1–T9)

All must pass on a physical phone before release. The point of T2 is a screenshot: airplane-mode icon + empty network log + working app in one frame — the whole offline claim.

Preparation: install a development build (or Expo Go), open the app once online so live levels are fetched (Offline data → "Refresh live levels now"), pick an area and a station in onboarding, and add one free block.

| # | Test | Procedure | Pass criteria |
|---|---|---|---|
| T1 | Cold start offline | Online refresh → force-quit → airplane mode ON → launch | All three tabs render immediately with hours and the typical pattern. No spinner, no error dialog. OFFLINE MODE banner at the top of every screen. |
| T2 | Zero network calls | In airplane mode, visit all three tabs and every sub-screen (spot, check-in, why, profile, preferences, free blocks, offline data). Record with a proxy (mitmproxy / Charles) or the dev-client network inspector. | Request log is empty. Screenshot it. |
| T3 | Offline write persistence | Airplane mode → post a check-in, start a session, add two goals, add a free block → force-quit → reboot the phone → launch | The check-in is listed on the spot ("not shared yet"), the session is still running at the right block, the goals and the free block are still there. |
| T4 | Recovery after reconnect | Turn airplane mode OFF, return to the app | Within 60 s the status line reads "Live levels checked just now" and the check-in loses its "not shared yet" tag (sharing on). No duplicate check-ins. |
| T5 | Worst case | Fresh install → immediately airplane mode ON → launch | Onboarding works. Now tab ranks spots from the bundled directory with "Typical pattern · no live reports". Map draws. Nothing is blank. |
| T6 | Slow network | Throttle to 3G with 20 % loss (Network Link Conditioner / emulator) → open app | UI never blocks; the ranking renders first; the refresh finishes or fails silently and the status line says so. |
| T7 | Wrong hours never pass silently | Set the device clock to a Monday 11:35 PM → Now tab | Spots closing at midnight show "closes in 25 min" (amber), Alexander shows as open past midnight, closed spots show "Opens Tue 8:00 AM". Nothing claims to be open that is not. |
| T8 | Honest confidence | Fresh install, post ONE check-in at a spot you are 500 m away from | The level is published as that level but labelled "1 report, just now"; after 50 minutes it reads "unverified" and the range widens; after 3 hours it is gone and the spot reads "Typical pattern · no live reports". |
| T9 | Timer survives sleep | Start a 25/5 session → lock the phone for 27 minutes → unlock | The ring shows the break of block 1 with the right seconds; a local notification fired at 25:00. Pause for 5 minutes and resume: the remaining time has not moved. |

## State matrix — every screen must handle all six

| State | Expected | Forbidden |
|---|---|---|
| Online · cache present | Render cache → refresh in background → replace quietly | Full-screen spinner |
| Offline · cache present | Render cache + OFFLINE banner + "checked X ago" time stamps | Error dialog, blank screen |
| Offline · no cache | Bundled directory + typical pattern labelled as such | "Check your connection" and nothing else |
| Online · cache expired | Render + "older than expected" on the Offline data screen + one-tap refresh | Old levels presented as current |
| No reports (quiet day) | Range from the typical pattern, "no live reports" | Fake precision, empty state |
| Low storage | Keep prefs / focus log / directory / maps, drop cached levels and old check-ins first, say what was dropped | Silent failure, crash |

## Demo script (judging video)

1. Offline data → Demo & testing → **Finals**. Now tab: the clock jumps to 3 PM on a weekday, libraries read Packed/Full with "demo" labels, Alexander carries a "Finals: open 24 hours (demo)" exception, student centers read Filling — the redistribution the app can do today.
2. Tap Alexander → **Why this ranking?** The score is five weighted terms you can read; the level is reports × decay + a 0.03 prior; the walk is `m × 1.3 ÷ 80`. A formula, not a model.
3. Check in at Alexander: one tap on "Chill". Back on the spot the level reads "Chill · 1 report, just now" — the student's truth outweighs the pattern, honestly labelled.
4. **Late night** scenario: 11:35 PM. "Carr closes in 25 min · Alexander stays open past midnight" with the student-ID note.
5. Airplane mode ON → force-quit → relaunch. Every tab still opens; OFFLINE MODE banner shows; hours and the typical pattern are still right. This is the whole claim.
6. Focus tab: start a 50/10 session with two goals. Lock the phone, come back: the ring is correct to the second. End → "Session logged" → Your week shows the hour band you focus in.

## Deep links

`studyspace://?demo=finals` (also `quiet`, `late`, `live`; development builds only) · `studyspace://map?area=newark` (also `new-brunswick`, `hoboken`, `princeton`) · `studyspace://spot/alexander-library` · `studyspace://checkin/carr-library`.

On the iOS Simulator with Metro running: `xcrun simctl openurl booted "exp://127.0.0.1:8081/--/map?area=hoboken"`.

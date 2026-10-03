# Venue sources (evidence trail)

Every venue in `assets/data/venues.json` carries `hoursSource`, `hoursVerified`, `verifiedBy` and `lastVerified`. This file records where each fact came from and when it was read, so a reviewer can check it and a future maintainer can re-verify it. All hours were read on **3 October 2026** for the regular fall term; LibCal pages publish week-by-week, so the week of 27 Sep – 3 Oct 2026 was used as the regular pattern.

No venue is a partner and none was contacted. Capacities are `null` everywhere because no venue publishes a seat count; the app does not need one.

## Rutgers University Libraries (New Brunswick / Newark)

| Venue | Hours source | Other facts |
|---|---|---|
| Alexander Library, 169 College Ave | libcal.rutgers.edu/hours — Sun 11 AM–2 AM, Mon–Thu 8 AM–2 AM, Fri 8 AM–9 PM, Sat 1 PM–6 PM | Floors from the library's Building Directory page (quiet areas NW-2A/2B, Undergraduate Reading Room SW-1, Digital Learning Commons NW-1, group rooms NW/SW-3, café and Room 038 study area in the basement). Computer counts (62 PCs, 8 Macs) and DLC staffed hours from it.rutgers.edu › New Brunswick computer labs › Alexander Library, fall 2026. 24-hour finals periods announced per term (libraries.rutgers.edu/news, May 2025 example). Phone 848-932-7851. |
| James Dickson Carr Library, 75 Avenue E | libcal.rutgers.edu/hours — Sun 2:30–10 PM, Mon–Thu 8 AM–12 AM, Fri 8 AM–7 PM, Sat 1–6 PM | Renaming (Board of Governors, 8 Feb 2017; formerly Kilmer Area Library, 1971) and floor description ("tables on the first floor, quiet carrel on the second, group study rooms") from the Carr Library locations page. Phone 848-445-3613. |
| Library of Science and Medicine, 165 Bevier Rd | libcal.rutgers.edu/hours — same as Carr | 3rd-floor RWJ service point (Room 300b) from the LSM locations page. Phone 848-445-3854. |
| Mabel Smith Douglass Library, 8 Chapel Dr | libcal.rutgers.edu/hours — same as Carr | Address from the Rutgers Libraries locations index. |
| Art Library, 71 Hamilton St | libcal.rutgers.edu/hours — Mon–Fri 9 AM–5 PM, closed weekends | In the Zimmerli Art Museum building; pin is the museum entrance (medium confidence). |
| John Cotton Dana Library (Rutgers–Newark), 185 University Ave | libcal.rutgers.edu/hours — Sun 2–10 PM, Mon–Thu 8 AM–12 AM, Fri 8 AM–6 PM, Sat 9 AM–5:30 PM | Entry rule ("current physical RU ID card or physical government-issued ID") from libraries.rutgers.edu/newark/visit-study. Phone 973-353-5161. |

Also considered and left out of v1: Chang Library (Cook) and Math & Physics Library (Busch) — small branches, Mon–Fri 9–5 — can be added from the same LibCal page; Smith and RWJ health-sciences libraries are medical-school spaces.

## Rutgers student centers

Hours from sca.rutgers.edu › Student Centers › Hours and Directions (read 3 Oct 2026): Busch, Livingston and Douglass student centers Mon–Fri 8 AM–12 AM, Sat–Sun 11 AM–12 AM; College Avenue Student Center Mon–Fri 7 AM–12 AM, Sat–Sun 9 AM–12 AM. Named study rooms (Busch "The Cove", Livingston "The Space", Collaborative Learning Center, the 24-hour outdoor courtyard) from the Rutgers Study Space Finder (webapps.rutgers.edu/study-spaces), which lists 97 spaces and no seat counts.

## Other institutions

| Venue | Hours source | Other facts |
|---|---|---|
| New Brunswick Free Public Library, 60 Livingston Ave | nbfpl.org home page — Mon–Thu 10 AM–9 PM, Fri–Sat 10 AM–5 PM, Sunday not listed (treated as closed) | Phone (732) 745-5108. |
| Hidden Grounds Chai & Coffee House, 106 Easton Ave | Public listing (Yelp, June 2026) — Mon–Fri 7 AM–6 PM, Sat–Sun 8 AM–6 PM | Not confirmed with the café; `hoursVerified` is set to 2026-06-01 so the app flags it sooner. |
| Newark Public Library — Main Library, 5 Washington St | npl.org/about-the-library/hours — Mon 9 AM–5:30 PM, Tue–Thu 9 AM–8:30 PM, Fri–Sat 9 AM–5:30 PM, Sun closed | Phone (973) 733-7779. |
| Robert W. Van Houten Library (NJIT), Central Avenue Building | njit.libcal.com/hours — Sun 1 PM–12 AM, Mon–Thu 8 AM–2 AM, Fri 8 AM–10 PM, Sat 10 AM–10 PM (weeks of 27 Sep and 4 Oct 2026) | Address and phone (973) 596-3206 from library.njit.edu. OSM places the building at 154 Summit St (medium confidence). |
| Hoboken Public Library — Main Library, 500 Park Ave | Regular hours from public listings (Apple Maps / Hoboken Girl): Mon–Thu 10 AM–8 PM, Fri–Sat 10 AM–5 PM, Sun 10 AM–3 PM | Closure 13 Aug – 4 Oct 2026 and the 5 Oct 2026 reopening of floors 2–3 from hobokenlibrary.org/renovation and NJ Stage (29 Jul 2026); encoded as two exceptions. hobokenlibrary.org showed the main building as closed on 3 Oct 2026, consistent with that. |
| Hoboken Public Library — Grand Street Branch, 124 Grand St | hobokenlibrary.org — Mon–Thu 10 AM–8 PM, Fri–Sat 10 AM–5 PM, Sun closed | Phone (201) 420-2346 x5301. |
| Samuel C. Williams Library (Stevens), 1 Castle Point Terrace | stevens.libcal.com/hours — Sun 12 PM–2 AM, Mon–Thu 8 AM–2 AM, Fri 8 AM–10 PM, Sat 10 AM–10 PM (week of 27 Sep 2026) | Summer 2026 renovation closure (16 May – 23 Aug) from library.stevens.edu research guides. Phone 201-216-5200. |
| Princeton Public Library, 65 Witherspoon St | princetonlibrary.org — Mon–Thu 9 AM–8 PM, Fri–Sat 9 AM–5 PM, Sun 12–5 PM | Phone 609-924-9529. |

## Coordinates, stations and maps

- Venue and station coordinates: OpenStreetMap via Nominatim (nominatim.openstreetmap.org), 3 Oct 2026. `coordConfidence` is `high` when Nominatim returned the named building, `medium` when it returned the complex or a neighbouring building.
- Station modes and lines: NJ Transit, PATH and Amtrak public system maps.
- Map lines (`assets/data/maps/*.json`): Overpass API extracts of OpenStreetMap ways (rivers, canals, coastline, `railway=rail` main lines, light rail/PATH, a whitelist of named roads) and `railway=station` nodes, simplified with Douglas–Peucker and clipped to each area box by `scripts`-style tooling described in the README. © OpenStreetMap contributors, ODbL 1.0. The simplified files are derivative databases and remain under ODbL.

## Things the app deliberately does not claim

- Seat counts, occupancy percentages or "spaces at capacity" — not published by any venue; the app shows five relative levels.
- Partner deals, café laptop policies, accessibility audits — unknown; shown as "Not confirmed".
- Finals 24-hour dates for 2026 — not yet announced at time of writing; the finals demo scenario injects a clearly labelled hypothetical exception.

# Design direction and audit

StudySpace should read as a first-party iOS utility — the register of Weather, Reminders and Settings — not as a themed web page and not as a demo. Same system as the sibling app (`../nmi-typhoon-watch`): grouped inset lists, one accent, three semantic colours, system type, no shadows, no icon backgrounds, no spinners. This document fixes the rules so every screen is checked against the same list, and records the audit that produced them (56 simulator screenshots across every screen, demo scenario, offline state and two Dynamic Type sizes, 2026-10-04).

## Direction

| Principle | Rule |
|---|---|
| One job per screen | Now = where to go; Map = where things are; Focus = work. Everything else is a sub-screen reached from those three. |
| One primary action | At most one filled navy button per screen. Alternatives are tonal (light navy) or secondary (grey). Red only for *End session* and *Erase*. Green only for *Log session* when the plan is complete. |
| Honesty is a footnote, not a speech | Every level carries its honesty line ("2 reports agree · newest 3 min ago", "Typical pattern · no live reports"). That line is `Footnote`, one line, under the thing it qualifies. No sentence anywhere argues for the product. |
| Never a bare percentage | Levels are the five words plus bars. Percentages exist only behind *Show the arithmetic*. |
| Demo is one line | A demo scenario adds exactly one `Footnote` under the large title ("Demo · clock set to Mon 3:00 PM") and the word "demo" at the end of the honesty line. Nothing else changes. |
| Copy | Sentence case. Section headers are nouns ("Hours", "Zones", "Getting there"). Footers are at most one sentence. Times: "until midnight", "until 2 AM", "open 24 hours", "closes in 25 min", "opens Tue 8:00 AM". Dates: "Sun 4 Oct". No "·" chains longer than three items. |

## Type scale — the only sizes in the app

All text styles live in `src/ui/theme.ts`. No `fontSize`, `fontWeight`, `lineHeight` or `letterSpacing` literal appears anywhere else; SVG text takes its size from the same tokens.

| Token | Size / line | Weight | Colour | Use | Max Dynamic Type |
|---|---|---|---|---|---|
| `largeTitle` | 28 / 34 | 700 | ink | page title | 1.5× |
| `title3` | 20 / 25 | 600 | ink | in-card heading | system |
| `headline` | 17 / 22 | 600 | ink | callout title, button label, cell emphasis | 1.5× (buttons) |
| `body` | 17 / 22 | 400 | ink | cell title, paragraph | system |
| `subheadline` | 15 / 20 | 400 | ink2 | page subtitle, callout body | system |
| `footnote` | 13 / 18 | 400 | ink2 | cell subtitle, section footer, honesty line | system |
| `caption` | 12 / 16 | 400 | ink2 | chart legends, offline strip (600) | 1.4× |
| `caption2` | 11 / 13 | 600 | — | ring percentages | 1.15× |
| `sectionHeader` | 13 / 18 | 400 | ink2, uppercase | section header | system |
| `display` | 34 / 40 | 700 | tone colour | the level word on a spot ("Packed") | 1.2× |
| `numerals` | 52 / 60 | 600, rounded, tabular | ink | timer ring | 1.1× (fits) |
| `control` / `controlSmall` | 15 / 20 · 13 / 18 | 500 (600 selected) | ink | segmented control labels; small when four or more options share the row | 1.3× (fits) |
| `tabLabel` | 10.5 | 500 | tint / ink2 | tab bar | none (UIKit behaviour) |
| `mapLabel` / `mapAttribution` / `mapTag` / `legend` | 9.5 / 9.5 / 13 / 12.5 | 600 / 400 / 600 / 600 | ink2 | SVG map text, attribution, map legend | none |
| `mapPin` / `chartAxis` | 10 / 10 | 800 / 400 | white / ink2 | SVG pin numeral, chart axis labels | none |

## Component rules

- **Cell**: leading icon or bars (fixed width) · title `body` · subtitle `footnote` (wraps, at most two lines of content) · optional value `body`/ink2/tabular · optional chevron. Separator inset to the title edge. Pressed state = fill, no scale.
- **Section**: uppercase `sectionHeader`, optional right-aligned header note (same style; at large text sizes it wraps under the title and stays right-aligned), one `footnote` footer of at most one sentence.
- **Callout**: inline icon in the tone colour · `headline` title · `subheadline` body. Tones: navy information, amber caution (closing soon, exceptions, stale), red hard stop (closed for renovation), green done.
- **Buttons**: 50 pt, 12 pt radius, `headline` label, optional 18 pt icon. Variants: primary (navy), tonal, secondary, red, green, ghost. Side-by-side pairs stack vertically above 1.3× text scale.
- **Segmented**: iOS style; with four or more options every label uses the smaller control size uniformly (no per-segment shrinking) and labels are chosen to fit ("N. Brunswick"). Where the options have descriptions (choosing an area in Preferences/Onboarding) use a check list of Cells instead, like the station picker.
- **Levels**: five bars, filled = level + 1, range bars at 35 % opacity; colour by tone (green Empty/Chill, amber Filling, red Packed/Full); grey when closed; half strength when the level comes from the typical pattern with no live report. Always paired with the level word.
- **Icons**: SF Symbols on iOS, Ionicons elsewhere, tinted, never on a background. Decorative by default — hidden from VoiceOver — unless the icon is the only content (then it carries an explicit label).
- **Learned hours**: in the typical-day chart an hour whose level comes from student reports carries a 2 pt ink underline; the legend reads "▁ student reports" and the footer counts them. Reports from elsewhere are labelled in the honesty line ("· not at the spot") and never raise confidence.
- **Empty states**: one Cell with a muted icon, a title and a one-line subtitle. Never a blank group.
- **Dynamic Type**: text scales per the table above; rows grow, nothing truncates except the one-line honesty line in the map list. The root remounts when the font scale changes so already-mounted tabs re-measure.

## Audit (2026-10-04) — what the screenshots showed

Legend: ✓ consistent · ✗ fix in G004 · ○ accepted deviation.

| Screen / state | Result | Notes |
|---|---|---|
| Now — live, early morning | ✓ | Empty state cell "Nothing is open right now · First to open: …" reads right. |
| Now — gap card | ✗ copy | "Spots open until then rank higher · from you" → "Ranking spots open until then · from your position". |
| Now — finals / quiet / late | ✓ | Two-line subtitles, range bars, "until midnight", "Closes at midnight, before you would arrive" all consistent. |
| Now — level bars with no reports | ✗ | Typical-pattern rows use the same colour strength as live rows; mute bars when confidence is none. |
| Map — four areas | ✓ map · ✗ list | Map card, legend, station glyphs, off-map badge fine. List rows: "closes Tue 12:00 AM" must match Now ("until midnight"); honesty line truncates with "…" — allow wrapping; "Typical pattern · no live reports" shortens to "typical pattern" in list rows. |
| Map — Hoboken | ○ | Terminal yard tracks are busy but legible; acceptable. |
| Spot — open with exception | ✗ copy ✗ bug | "Today Open 24 hours" → "Open 24 hours today". Exception dates render one day early ("Sun 4 Oct – Tue 30 Mar" for 5 Oct – 31 Mar) because `Date.parse('YYYY-MM-DDT12:00')` uses device time; must use `zonedToEpoch`. |
| Spot — zones | ✗ icon | Low-murmur zones use a person icon here and a speaker icon on the check-in screen; unify on speaker-slash / speaker-1 / speaker-2. |
| Spot — About | ✓ | Source / Checked / Call / Website rows; the Carr note is long — trim in data. |
| Why — collapsed | ✓ | Four plain rows then "Show the arithmetic". |
| Why — expanded | ✗ copy | "Open until 12:00 AM" → "Open until midnight". Right-aligned multi-line values are acceptable inside the arithmetic. |
| Check-in | ✓ | Zone list, five level rows, optional sections, presence row, disabled primary until a level is chosen. |
| Focus — running / done | ✗ title | Large title flips between "Focus", "Break" and "Done"; a tab title must stay "Focus" (state lives in the ring). |
| Profile, Preferences, Free blocks, Offline data, Not found | ✓ | Consistent groups, headers, footers; one primary each. |
| Preferences / Onboarding — area control | ✗ | Four-option segmented shrinks "New Brunswick" alone; use the uniform control size. |
| Offline banner | — | Capture failed (toggle did not take); verify after fixes. |
| Onboarding | — | Capture failed (reset dialog); verify after fixes. |
| Dynamic Type — accessibility large, fresh screens | ✓ | Spot, check-in and why wrap correctly; side-by-side buttons wrap their labels — stack them above 1.3×. |
| Dynamic Type — already-mounted tabs | ✗ | Stale text layout (clipped titles) until remount; remount the root on font-scale change. |
| VoiceOver | ✗ | SF Symbol names leak ("duration, No free block today…"); hide decorative icons. |
| Type literals | ✗ | 16 ad-hoc `fontSize`/`fontWeight` literals outside `theme.ts` (level hero, timer numerals, buttons, segmented, offline strip, back button, ring text, formula, tab label, map text) → tokens above. |

## G004 result (2026-10-04, re-shot after the fixes)

Every ✗ above was fixed and re-verified on the simulator; the capture set is in the session log. Additional defects found while re-shooting and fixed in the same pass: "1h 60m left" (duration rounding), the spot hero showing full-strength bars for a typical-pattern level, the map attribution pill scaling over the map at large text, a two-line offline strip, and the area picker — now a check list in Preferences/Onboarding, short labels on the Map control.

Accepted deviations (○): the four-option segmented control truncates at accessibility text sizes exactly as UIKit's does; the Hoboken map's terminal yard tracks are busy but legible.

Type literals outside `theme.ts`: zero (the four remaining `fontWeight` references are token lookups).

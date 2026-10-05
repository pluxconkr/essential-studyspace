/**
 * Design tokens — native iOS idiom (grouped inset lists, SF Pro, one accent), light only.
 *
 * Three semantic colours: Navy = information / tint, Red = warning (Packed/Full), Green = good
 * (Empty/Chill, done). Amber is reserved for caution: Filling, closing soon, stale data.
 * Surfaces follow iOS system grouped backgrounds so the app reads like a first-party utility.
 */
import { Platform, type TextStyle } from 'react-native';

const palette = {
  navy: '#0F2B4C',
  navyTint: '#1F55A6', // interactive tint (links, buttons, icons)
  navyFill: '#E6EEF9', // tinted fill for secondary buttons / selection
  red: '#B3261E',
  green: '#1B7F4C',
  amber: '#8A5A00',
  label: '#0B0F19',
  secondaryLabel: 'rgba(60,60,67,0.75)', // iOS uses 0.60 (3.4:1); 0.75 clears WCAG AA 4.5:1 on both surfaces
  tertiaryLabel: 'rgba(60,60,67,0.30)',
  separator: 'rgba(60,60,67,0.16)',
  groupedBackground: '#F2F2F7',
  secondaryGroupedBackground: '#FFFFFF',
  fill: 'rgba(120,120,128,0.12)',
  white: '#FFFFFF',
} as const;

/** Semantic aliases used by screens. */
export const colors = {
  navy: palette.navy,
  tint: palette.navyTint,
  navySoft: palette.navyFill,
  red: palette.red,
  green: palette.green,
  amber: palette.amber,
  ink: palette.label,
  ink2: palette.secondaryLabel,
  ink4: palette.tertiaryLabel,
  line: palette.separator,
  bg: palette.groupedBackground,
  surface: palette.secondaryGroupedBackground,
  fill: palette.fill,
  offlineBar: '#E5E5EA',
  offlineText: 'rgba(60,60,67,0.85)',
  white: palette.white,
} as const;

/** Crowd-level tones → colours. Level is never colour alone: the bar count and label always accompany it. */
export const toneColor = { green: colors.green, amber: colors.amber, red: colors.red } as const;

export const fonts = {
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  /** Big numerals (timer): SF Rounded on iOS, system elsewhere. Always tabular. */
  rounded: Platform.select({ ios: 'ui-rounded', android: 'sans-serif', default: 'System' }),
} as const;

/** Tabular figures so digits never jitter. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const radius = { group: 12, button: 12 } as const;

/** Horizontal page margin (iOS inset grouped). */
export const GUTTER = 16;
/** Minimum touch target (pt). */
export const MIN_TAP = 44;
/** Cell horizontal padding inside a group. */
export const CELL_PAD = 16;

/** iOS text styles (sizes at default Dynamic Type). Body ≥ 15. */
export const type = {
  largeTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.4, color: colors.ink },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' as const, letterSpacing: -0.2, color: colors.ink },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.41, color: colors.ink },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const, letterSpacing: -0.41, color: colors.ink },
  subheadline: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const, letterSpacing: -0.24, color: colors.ink2 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: -0.08, color: colors.ink2 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const, color: colors.ink2 },
  sectionHeader: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: -0.08, textTransform: 'uppercase' as const, color: colors.ink2 },
  /** The level word on a spot ("Packed"). */
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' as const, letterSpacing: -0.4, color: colors.ink },
  /** Timer ring numerals. */
  numerals: { fontFamily: fonts.rounded, fontSize: 52, lineHeight: 60, fontWeight: '600' as const, letterSpacing: -0.5, color: colors.ink },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: '600' as const, color: colors.ink2 },
  /** Segmented-control labels; `controlSmall` when four or more options share the row. */
  control: { fontSize: 15, lineHeight: 20, fontWeight: '500' as const, color: colors.ink },
  controlSmall: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const, color: colors.ink },
  /** Tab bar labels do not scale, like UIKit. */
  tabLabel: { fontSize: 10.5, fontWeight: '500' as const },
  /** SVG map text (no Dynamic Type). */
  mapLabel: { fontSize: 9.5, lineHeight: 12, fontWeight: '600' as const, color: colors.ink2 },
  mapAttribution: { fontSize: 9.5, lineHeight: 12, fontWeight: '400' as const, color: colors.ink2 },
  mapTag: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const, letterSpacing: -0.08, color: colors.ink2 },
  mapPin: { fontSize: 10, fontWeight: '800' as const },
  legend: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' as const, color: colors.ink2 },
  chartAxis: { fontSize: 10, fontWeight: '400' as const, color: colors.ink2 },
} as const;

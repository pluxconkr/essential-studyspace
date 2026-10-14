/**
 * Free blocks — the student's gaps between classes, entered by hand. The home screen ranks spots
 * that stay open until the gap ends. Pure functions.
 *
 * How it fits: useRanking (store/derived.ts) calls currentOrNextGap() on every clock tick; while a gap is in
 * progress its end becomes the ranking's stay-open target (RankContext.gapEndsAt) and the Now tab shows
 * "Free until …". The free-blocks screen (app/blocks.tsx) lists, validates and labels them. Blocks live in
 * Prefs; their minutes are New Jersey local time.
 */
import { formatMinutes, zonedParts, zonedToEpoch } from './time';
import type { FreeBlock } from './types';

/** Today's current or next free block, resolved to epoch ms on today's NJ date. */
export interface ActiveGap {
  block: FreeBlock;
  startsAt: number;
  endsAt: number;
  /** true when the gap is happening now; false when it is the next one today. */
  now: boolean;
}

/**
 * The gap in progress, or the next one later today. null when nothing is left today.
 * Only blocks on today's NJ weekday count; among them the earliest-starting one that has not ended wins.
 */
export function currentOrNextGap(blocks: readonly FreeBlock[], now: number): ActiveGap | null {
  const p = zonedParts(now);
  const today = blocks.filter((b) => b.weekday === p.weekday).sort((a, b) => a.startMin - b.startMin);
  for (const b of today) {
    const startsAt = zonedToEpoch(p.dateKey, b.startMin);
    const endsAt = zonedToEpoch(p.dateKey, b.endMin);
    if (now >= startsAt && now < endsAt) return { block: b, startsAt, endsAt, now: true };
    if (now < startsAt) return { block: b, startsAt, endsAt, now: false };
  }
  return null;
}

/** "2:00 PM – 5:00 PM": a block's time range, on the Now tab and the free-blocks screen. */
export function formatBlock(b: Pick<FreeBlock, 'startMin' | 'endMin'>): string {
  return `${formatMinutes(b.startMin)} – ${formatMinutes(b.endMin)}`;
}

/** Whether a new block can be saved: weekday 0–6, inside one day (0 to 1440 min) and at least 30 minutes long. Enables the add button. */
export function blockValid(b: Pick<FreeBlock, 'startMin' | 'endMin' | 'weekday'>): boolean {
  return b.weekday >= 0 && b.weekday <= 6 && b.startMin >= 0 && b.endMin <= 1440 && b.endMin - b.startMin >= 30;
}

/** A sorted copy for the free-blocks list: by weekday, Monday first, then by start time. */
export function sortBlocks(blocks: readonly FreeBlock[]): FreeBlock[] {
  // Monday first, like a timetable.
  const order = (w: number) => (w + 6) % 7;
  return [...blocks].sort((a, b) => order(a.weekday) - order(b.weekday) || a.startMin - b.startMin);
}

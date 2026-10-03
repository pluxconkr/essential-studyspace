/**
 * Free blocks — the student's gaps between classes, entered by hand. The home screen ranks spots
 * that stay open until the gap ends. Pure functions.
 */
import { formatMinutes, zonedParts, zonedToEpoch } from './time';
import type { FreeBlock } from './types';

export interface ActiveGap {
  block: FreeBlock;
  startsAt: number;
  endsAt: number;
  /** true when the gap is happening now; false when it is the next one today. */
  now: boolean;
}

/** The gap in progress, or the next one later today. null when nothing is left today. */
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

/** "2:00 PM – 5:00 PM" */
export function formatBlock(b: Pick<FreeBlock, 'startMin' | 'endMin'>): string {
  return `${formatMinutes(b.startMin)} – ${formatMinutes(b.endMin)}`;
}

export function blockValid(b: Pick<FreeBlock, 'startMin' | 'endMin' | 'weekday'>): boolean {
  return b.weekday >= 0 && b.weekday <= 6 && b.startMin >= 0 && b.endMin <= 1440 && b.endMin - b.startMin >= 30;
}

export function sortBlocks(blocks: readonly FreeBlock[]): FreeBlock[] {
  // Monday first, like a timetable.
  const order = (w: number) => (w + 6) % 7;
  return [...blocks].sort((a, b) => order(a.weekday) - order(b.weekday) || a.startMin - b.startMin);
}

/**
 * Focus-session timer math. The schedule is absolute timestamps derived from `startedAt`, so a
 * phone that sleeps for twenty minutes rejoins at the right block instead of drifting.
 * No ticking counter is ever persisted — only the start time and the pauses.
 *
 * How it fits: `now` is whatever clock the caller stamps sessions with (the Focus and check-in screens
 * use the app clock, device time + demo offset). blockAt drives the timer ring and block strip through
 * useSessionState; remainingBoundaries feeds the block-change notifications; toFocusEntry turns an
 * ended session into a focus-log row. Pure functions: no storage, timers or notifications here.
 */
import { t } from '@/i18n';

import { toEpoch } from './time';
import type { FocusEntry, Session, TimerShape, TimerShapeId } from './types';

/** The session shapes offered on the Focus tab, in display order. 'free' is one open-ended focus block. */
export const TIMER_SHAPES: readonly TimerShape[] = [
  { id: 'p25', label: '25 / 5 × 4', focusMin: 25, breakMin: 5, blocks: 4 },
  { id: 'p50', label: '50 / 10 × 3', focusMin: 50, breakMin: 10, blocks: 3 },
  { id: 'p90', label: '90 / 15 × 2', focusMin: 90, breakMin: 15, blocks: 2 },
  { id: 'free', label: 'Free', focusMin: 0, breakMin: 0, blocks: 1 },
] as const;

/** The shape for an id; an unknown id falls back to 25 / 5 × 4 instead of throwing. */
export function shapeById(id: TimerShapeId): TimerShape {
  return TIMER_SHAPES.find((s) => s.id === id) ?? TIMER_SHAPES[0];
}

/** One-line description of a timer shape, in the current language. */
export const shapeBlurb = (id: TimerShapeId) => t(`timer.${id}` as const);
/** Display label; "Free" is the only one that is a word, so it is the only one translated. */
export const shapeLabel = (s: TimerShape) => (s.id === 'free' ? t('timer.freeLabel') : s.label);

/** One planned block in active (unpaused) time. A break shares `index` with the focus block before it. */
export interface Block {
  index: number; // 0-based block number
  kind: 'focus' | 'break';
  startMs: number; // offset from session start, in "active" time
  endMs: number;
}

/** The planned block list in active (unpaused) milliseconds: focus, break, focus, … with no break after the last focus. Free sessions have one open block. */
export function scheduleOf(shape: TimerShape): Block[] {
  if (shape.id === 'free') return [{ index: 0, kind: 'focus', startMs: 0, endMs: Number.POSITIVE_INFINITY }];
  const out: Block[] = [];
  let t = 0;
  for (let i = 0; i < shape.blocks; i++) {
    out.push({ index: i, kind: 'focus', startMs: t, endMs: t + shape.focusMin * 60_000 });
    t += shape.focusMin * 60_000;
    if (i < shape.blocks - 1) {
      out.push({ index: i, kind: 'break', startMs: t, endMs: t + shape.breakMin * 60_000 });
      t += shape.breakMin * 60_000;
    }
  }
  return out;
}

/**
 * Active (unpaused) milliseconds since the session started: up to `endedAt` once ended, minus the banked pauses
 * (`pausedMs`) and, while the session is still running, the pause in progress. Never negative.
 * Once `endedAt` is set an open pause is no longer subtracted, so a session ended while paused counts that pause as active.
 */
export function activeMs(session: Session, now: number): number {
  const start = toEpoch(session.startedAt);
  const end = session.endedAt ? toEpoch(session.endedAt) : now;
  const pausedNow = session.pausedAt && !session.endedAt ? Math.max(0, end - toEpoch(session.pausedAt)) : 0;
  return Math.max(0, end - start - session.pausedMs - pausedNow);
}

/** Where a session stands at one instant, as the timer ring and block strip draw it. 'done' once every planned block has passed. */
export interface BlockState {
  kind: 'focus' | 'break' | 'done';
  /** 1-based block number for display ("block 2 of 4"). */
  blockNo: number;
  /** Focus blocks in the shape (1 for a free session). */
  blocks: number;
  remainingMs: number | null; // null = open-ended
  /** Active time into the current block; once done, the session's whole active time. */
  elapsedMs: number;
  /** Length of the current block; null for an open-ended block and once done. */
  totalMs: number | null;
  /** Paused and not ended. */
  paused: boolean;
}

/**
 * The block a session is in at `now`, read from active time alone: the first planned block not yet over, else 'done'.
 * A paused session stays in the block it was paused in; a free session stays in one open-ended focus block.
 * Recomputed by useSessionState every second while the session runs.
 */
export function blockAt(session: Session, now: number): BlockState {
  const shape = shapeById(session.shapeId);
  const active = activeMs(session, now);
  const paused = !!session.pausedAt && !session.endedAt;
  const plan = scheduleOf(shape);
  for (const b of plan) {
    if (active < b.endMs) {
      const total = Number.isFinite(b.endMs) ? b.endMs - b.startMs : null;
      return { kind: b.kind, blockNo: b.index + 1, blocks: shape.blocks, remainingMs: total === null ? null : b.endMs - active, elapsedMs: active - b.startMs, totalMs: total, paused };
    }
  }
  return { kind: 'done', blockNo: shape.blocks, blocks: shape.blocks, remainingMs: 0, elapsedMs: active, totalMs: null, paused };
}

/** Seconds spent in focus blocks (breaks excluded), capped at the plan; a free session counts all its active time. Shown on the Focus tab (under the ring and in the end dialog) and logged by toFocusEntry. */
export function focusSeconds(session: Session, now: number): number {
  const shape = shapeById(session.shapeId);
  const active = activeMs(session, now);
  let s = 0;
  for (const b of scheduleOf(shape)) {
    if (b.kind !== 'focus') continue;
    const end = Math.min(active, b.endMs);
    if (end > b.startMs) s += end - b.startMs;
  }
  return Math.floor(s / 1000);
}

/**
 * All remaining boundaries from now (one notification each): when each block still ahead ends, the kind of block
 * that ends there, its 1-based number, and whether it ends the session. `at` is `now` plus the active time left,
 * so it is on the same clock as `now`. Empty while paused or ended, and for a free session (no boundaries).
 * Read by notifications.scheduleSessionNotifications, which is re-run after start, resume and skip.
 */
export function remainingBoundaries(session: Session, now: number): { at: number; kind: 'focus' | 'break'; blockNo: number; blocks: number; last: boolean }[] {
  if (session.pausedAt || session.endedAt) return [];
  const shape = shapeById(session.shapeId);
  if (shape.id === 'free') return [];
  const active = activeMs(session, now);
  const plan = scheduleOf(shape);
  const out: { at: number; kind: 'focus' | 'break'; blockNo: number; blocks: number; last: boolean }[] = [];
  for (let i = 0; i < plan.length; i++) {
    const b = plan[i];
    if (b.endMs <= active) continue;
    out.push({ at: now + (b.endMs - active), kind: b.kind, blockNo: b.index + 1, blocks: shape.blocks, last: i === plan.length - 1 });
  }
  return out;
}

/**
 * The focus-log row for a session: spot, shape, start, end (`endedAt`, else `now`), focus seconds and goals done
 * out of goals set. actions.endSession writes it to the student's log, which the Your week stats read.
 */
export function toFocusEntry(session: Session, now: number): FocusEntry {
  const ended = session.endedAt ?? new Date(now).toISOString();
  return {
    sessionId: session.sessionId,
    venueId: session.venueId,
    shapeId: session.shapeId,
    startedAt: session.startedAt,
    endedAt: ended,
    focusSeconds: focusSeconds({ ...session, endedAt: ended }, now),
    goalsDone: session.goals.filter((g) => g.done).length,
    goalsTotal: session.goals.length,
    isDemo: session.isDemo,
  };
}

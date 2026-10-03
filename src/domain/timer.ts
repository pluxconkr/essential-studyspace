/**
 * Focus-session timer math. The schedule is absolute timestamps derived from `startedAt`, so a
 * phone that sleeps for twenty minutes rejoins at the right block instead of drifting.
 * No ticking counter is ever persisted — only the start time and the pauses.
 */
import { toEpoch } from './time';
import type { FocusEntry, Session, TimerShape, TimerShapeId } from './types';

export const TIMER_SHAPES: readonly TimerShape[] = [
  { id: 'p25', label: '25 / 5 × 4', focusMin: 25, breakMin: 5, blocks: 4, blurb: 'Four short blocks. Good for problem sets.' },
  { id: 'p50', label: '50 / 10 × 3', focusMin: 50, breakMin: 10, blocks: 3, blurb: 'Lecture-length blocks. Good for reading.' },
  { id: 'p90', label: '90 / 15 × 2', focusMin: 90, breakMin: 15, blocks: 2, blurb: 'Deep work. Good for writing.' },
  { id: 'free', label: 'Free', focusMin: 0, breakMin: 0, blocks: 1, blurb: 'Open-ended. Counts time until you stop.' },
] as const;

export function shapeById(id: TimerShapeId): TimerShape {
  return TIMER_SHAPES.find((s) => s.id === id) ?? TIMER_SHAPES[0];
}

export interface Block {
  index: number; // 0-based block number
  kind: 'focus' | 'break';
  startMs: number; // offset from session start, in "active" time
  endMs: number;
}

/** The planned block list in active (unpaused) milliseconds. Free sessions have one open block. */
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

export function totalPlannedMs(shape: TimerShape): number {
  if (shape.id === 'free') return Number.POSITIVE_INFINITY;
  return shape.blocks * shape.focusMin * 60_000 + (shape.blocks - 1) * shape.breakMin * 60_000;
}

/** Active (unpaused) milliseconds since the session started. */
export function activeMs(session: Session, now: number): number {
  const start = toEpoch(session.startedAt);
  const end = session.endedAt ? toEpoch(session.endedAt) : now;
  const pausedNow = session.pausedAt && !session.endedAt ? Math.max(0, end - toEpoch(session.pausedAt)) : 0;
  return Math.max(0, end - start - session.pausedMs - pausedNow);
}

export interface BlockState {
  kind: 'focus' | 'break' | 'done';
  /** 1-based block number for display ("block 2 of 4"). */
  blockNo: number;
  blocks: number;
  remainingMs: number | null; // null = open-ended
  elapsedMs: number;
  totalMs: number | null;
  paused: boolean;
}

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

/** Seconds spent in focus blocks (breaks excluded), capped at the plan. */
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

/** Absolute epoch ms of the next block boundary (for a local notification), or null. */
export function nextBoundaryAt(session: Session, now: number): number | null {
  if (session.pausedAt || session.endedAt) return null;
  const st = blockAt(session, now);
  if (st.kind === 'done' || st.remainingMs === null) return null;
  return now + st.remainingMs;
}

/** All remaining boundaries from now (one notification each). */
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

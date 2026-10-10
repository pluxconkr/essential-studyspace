/**
 * Low storage: when a write fails because the phone is full, the app gives up re-downloadable data by
 * priority (cached typical patterns → cached live levels → older check-ins), retries, and says what it dropped. Prefs and the
 * focus log are never dropped.
 */
import { SQLiteStorage } from 'expo-sqlite/kv-store';

import { KEYS, LOW_SPACE_CHECKIN_KEEP, checkInRepo, crowdRepo, focusLogRepo, onStorageNotice, patternRepo, prefsRepo, storageNoticeRepo } from '@/data/repos';
import { kv } from '@/data/kv';
import type { CheckIn, CrowdSnapshot, StorageNotice } from '@/domain/types';

const ci = (i: number): CheckIn => ({ checkInId: `c${i}`, kind: 'live', venueId: 'alexander-library', zoneId: null, level: 1, noise: null, amenities: [], note: null, at: new Date(Date.now() - i * 60_000).toISOString(), proof: { distanceM: null, gpsAccuracyM: null }, source: 'me', synced: true });
const snap: CrowdSnapshot = { fetchedAt: new Date().toISOString(), reports: {}, configured: false, storage: 'memory' };

function failWrites(key: string, times: number) {
  const orig = SQLiteStorage.prototype.setItemSync;
  let left = times;
  return jest.spyOn(SQLiteStorage.prototype, 'setItemSync').mockImplementation(function (this: SQLiteStorage, k: string, v: Parameters<SQLiteStorage['setItemSync']>[1]) {
    if (k === key && left > 0) {
      left -= 1;
      throw new Error('database or disk is full');
    }
    return orig.call(this, k, v);
  });
}

describe('storage guard', () => {
  let notices: StorageNotice[];

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    kv.clear();
    notices = [];
    onStorageNotice((n) => notices.push(n));
    crowdRepo.set(snap);
    patternRepo.set({ fetchedAt: new Date().toISOString(), months: ['2026-10'], patterns: {} });
    checkInRepo.replaceAll(Array.from({ length: 80 }, (_, i) => ci(i)));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    onStorageNotice(null);
  });

  test('a full disk drops the pattern cache, the crowd cache and older check-ins, then the focus-log write succeeds', () => {
    const spy = failWrites(KEYS.focusLog, 1);
    const next = focusLogRepo.add({ sessionId: 's', venueId: null, shapeId: 'p25', startedAt: 'a', endedAt: 'b', focusSeconds: 60, goalsDone: 0, goalsTotal: 0 });
    spy.mockRestore();
    expect(next).toHaveLength(1);
    expect(focusLogRepo.getAll()).toHaveLength(1);
    expect(patternRepo.get()).toBeNull();
    expect(crowdRepo.get()).toBeNull();
    expect(checkInRepo.getAll()).toHaveLength(LOW_SPACE_CHECKIN_KEEP);
    expect(checkInRepo.getAll()[0].checkInId).toBe('c0');
    expect(notices).toHaveLength(1);
    expect(notices[0].dropped).toEqual(['pattern-cache', 'crowd-cache', 'old-checkins']);
    expect(notices[0].recovered).toBe(true);
    expect(storageNoticeRepo.get()?.dropped).toEqual(['pattern-cache', 'crowd-cache', 'old-checkins']);
  });

  test('if the retry also fails the UI still gets the new state and the notice says it was not saved', () => {
    failWrites(KEYS.prefs, 2);
    const saved = prefsRepo.set({ ...prefsRepo.get(), noisePref: 'chatty' });
    expect(saved.noisePref).toBe('chatty');
    expect(notices.at(-1)?.recovered).toBe(false);
  });

  test('a crowd snapshot that cannot be written is reported, not retried, and nothing else is dropped', () => {
    kv.remove(KEYS.crowd);
    failWrites(KEYS.crowd, 5);
    expect(crowdRepo.set(snap)).toBe(false);
    expect(checkInRepo.getAll()).toHaveLength(80);
    expect(notices.at(-1)?.dropped).toEqual(['crowd-cache']);
  });
});

test('check-ins saved before report kinds existed read back as live on every path', () => {
  kv.clear();
  const old = { ...ci(1) } as Partial<CheckIn>;
  delete old.kind;
  kv.set(KEYS.checkins, [old]);
  expect(checkInRepo.getAll()[0].kind).toBe('live');
  expect(checkInRepo.add(ci(0))[1].kind).toBe('live');
  expect(checkInRepo.markSynced(['c1']).find((c) => c.checkInId === 'c1')?.kind).toBe('live');
});

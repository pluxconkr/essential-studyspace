/**
 * Best-effort periodic check of watched spots while the app is backgrounded (dev/production builds only;
 * not available in Expo Go, never on web). `defineTask` must run at module scope — this file is imported
 * for its side effect from the root layout. Reads the relay only; nothing is uploaded from the background.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { venueRepo, watchRepo } from '@/data/repos';
import { fuse } from '@/domain/levels';
import type { LiveLevel, Venue } from '@/domain/types';

import { fetchCrowd } from './crowdClient';
import { notifyWatchHits } from './notifications';

export const WATCH_POLL_TASK = 'studyspace-watch-poll';

if (Platform.OS !== 'web') {
  TaskManager.defineTask(WATCH_POLL_TASK, async () => {
    try {
      const watches = watchRepo.getAll();
      if (watches.length === 0) return BackgroundTask.BackgroundTaskResult.Success;
      const venues = venueRepo.get().venues;
      const snap = await fetchCrowd(watches.map((w) => w.venueId));
      if (!snap) return BackgroundTask.BackgroundTaskResult.Failed;
      const now = Date.now();
      const hits: { venue: Venue; live: LiveLevel }[] = [];
      for (const w of watches) {
        const v = venues.find((x) => x.venueId === w.venueId);
        if (!v) continue;
        const live = fuse({ venue: v, reports: snap.reports[v.venueId] ?? [], now });
        if (live.open && live.confidence !== 'none' && live.level <= w.notifyAtOrBelow) hits.push({ venue: v, live });
      }
      if (hits.length > 0) await notifyWatchHits(hits, new Date(now).toISOString());
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function ensureBackgroundPollRegistered(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    if (!(await TaskManager.isAvailableAsync())) return false;
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!(await TaskManager.isTaskRegisteredAsync(WATCH_POLL_TASK))) {
      await BackgroundTask.registerTaskAsync(WATCH_POLL_TASK, { minimumInterval: 15 });
    }
    return true;
  } catch {
    return false;
  }
}

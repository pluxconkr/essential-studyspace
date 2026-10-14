/**
 * Best-effort periodic check of watched spots while the app is backgrounded (dev/production builds only;
 * not available in Expo Go, never on web). Per the Expo docs, Expo Go has no TaskManager on Android and no
 * background execution on iOS, and iOS runs these tasks on physical devices only, never in the simulator.
 * `defineTask` must run at module scope: the root layout imports this file, and that import is what defines
 * the task. Reads the relay only; nothing is uploaded from the background.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { patternRepo, venueRepo, watchRepo } from '@/data/repos';

import { fetchCrowd } from './crowdClient';
import { notifyWatchHits } from './notifications';
import { watchHits } from './refresh';

/** Task name shared by defineTask and the registration below. */
export const WATCH_POLL_TASK = 'studyspace-watch-poll';

// The task body: watches, directory and learned baseline are read from storage (not the store), the relay is asked
// about the watched spots only, and hits are notified. Uses the device clock, not the demo-shifted app clock.
// Tells the OS Failed when the relay could not be read or anything threw, Success otherwise.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(WATCH_POLL_TASK, async () => {
    try {
      const watches = watchRepo.getAll();
      if (watches.length === 0) return BackgroundTask.BackgroundTaskResult.Success;
      const venues = venueRepo.get().venues;
      const snap = await fetchCrowd(watches.map((w) => w.venueId));
      if (!snap) return BackgroundTask.BackgroundTaskResult.Failed;
      const now = Date.now();
      const hits = watchHits(watches, venues, snap.reports, now, patternRepo.get()?.patterns);
      if (hits.length > 0) await notifyWatchHits(hits, new Date(now).toISOString());
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/**
 * Register the watch poll with the OS once, at a 15-minute minimum interval (the platform minimum; the system
 * picks the actual times, often far less often). True when the task is registered, now or on an earlier launch.
 * False on web, when TaskManager is unavailable (e.g. Expo Go on Android), when the OS reports background tasks
 * restricted, or on error. Called at boot from the root layout, which ignores the result.
 */
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

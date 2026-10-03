/**
 * Local notifications: a watched spot clearing up, and focus-block boundaries. Zero network.
 * Web: no-op (expo-notifications has no web implementation).
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { watchRepo } from '@/data/repos';
import { LEVEL_LABEL } from '@/domain/levels';
import { remainingBoundaries } from '@/domain/timer';
import type { LiveLevel, Session, Venue } from '@/domain/types';
import { getState } from '@/store/appStore';

export const CHANNEL_ID = 'studyspace';
let configured = false;

export async function configureNotifications(): Promise<void> {
  if (Platform.OS === 'web' || configured) return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'StudySpace',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 150],
        lightColor: '#0F2B4C',
      });
    }
  } catch {
    /* notifications unavailable (e.g. simulator restrictions) */
  }
}

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted || cur.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
    if (!cur.canAskAgain) return false;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  } catch {
    return false;
  }
}

/** A watched spot dropped to the asked-for level. At most one notice per venue per hour. */
export async function notifyWatchHits(hits: { venue: Venue; live: LiveLevel }[], nowIso: string): Promise<void> {
  if (Platform.OS === 'web' || hits.length === 0) return;
  if (!getState().settings.notificationsEnabled) return;
  const done = watchRepo.getNotified();
  const nowMs = Date.parse(nowIso);
  const fresh = hits.filter((h) => {
    const last = done[h.venue.venueId];
    return !last || nowMs - Date.parse(last) > 3600_000;
  });
  if (fresh.length === 0) return;
  await configureNotifications();
  const allowed = await ensurePermission();
  for (const h of fresh) watchRepo.markNotified(h.venue.venueId, nowIso);
  if (!allowed) return;
  for (const h of fresh) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: `${h.venue.shortName} is ${LEVEL_LABEL[h.live.level]}`, body: `${h.live.reports} recent report${h.live.reports === 1 ? '' : 's'} · tap to see the spot`, data: { venueId: h.venue.venueId } },
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
      });
    } catch {
      /* ignore */
    }
  }
}

let sessionNotificationIds: string[] = [];

export async function cancelSessionNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  const ids = sessionNotificationIds;
  sessionNotificationIds = [];
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      /* ignore */
    }
  }
}

/** One local notification per remaining block boundary. Re-run after pause/resume. */
export async function scheduleSessionNotifications(session: Session, now: number): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelSessionNotifications();
  if (!getState().settings.notificationsEnabled) return;
  const boundaries = remainingBoundaries(session, now);
  if (boundaries.length === 0) return;
  await configureNotifications();
  if (!(await ensurePermission())) return;
  for (const b of boundaries) {
    const title = b.last ? 'Session complete' : b.kind === 'focus' ? `Block ${b.blockNo} of ${b.blocks} done` : `Break over`;
    const body = b.last ? 'Nice work. Log how it went.' : b.kind === 'focus' ? 'Take your break. Chat opens now.' : `Back to it — block ${b.blockNo + 1} of ${b.blocks}.`;
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { session: session.sessionId } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(b.at), ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}) },
      });
      sessionNotificationIds.push(id);
    } catch {
      /* ignore */
    }
  }
}

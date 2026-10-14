/**
 * Local notifications: a watched spot clearing up, and focus-block boundaries. Zero network.
 * Web: no-op (expo-notifications has no web implementation).
 * Both kinds respect the Notifications switch (settings.notificationsEnabled), and permission is asked for only
 * when something is about to be delivered, never at boot. The switch is read when a notice is scheduled:
 * turning it off does not cancel focus-block alerts that are already scheduled.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { watchRepo } from '@/data/repos';
import { levelLabel } from '@/domain/levels';
import { t, tn } from '@/i18n';
import { remainingBoundaries } from '@/domain/timer';
import type { LiveLevel, Session, Venue } from '@/domain/types';
import { getState } from '@/store/appStore';

/** Android notification channel every notification goes to (created in configureNotifications). */
export const CHANNEL_ID = 'studyspace';
/** Set before the first setup attempt, so setup runs at most once per process (a failure is not retried). */
let configured = false;

/**
 * One-time setup: while the app is open, show notifications as a banner and in the list (no sound, no badge),
 * and create the Android channel. Errors are swallowed. Called at boot and again (a no-op) before delivering.
 */
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

/** True when notifications may be shown (granted, or iOS provisional). Shows the OS prompt only while the OS still allows asking. Never throws. */
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

/**
 * Announce watch hits: spots at or below the level their watch asks for. At most one notice per venue per hour.
 * It is a state, not a change, so a spot that stays quiet can be announced again once the hour has passed.
 * The last-notified time per venue is kept in storage and compared with `nowIso`. Each notice is delivered at
 * once: "<spot> is <level>", with the report count. Callers: refreshAll (app clock) and the background poll (device time).
 */
export async function notifyWatchHits(hits: { venue: Venue; live: LiveLevel }[], nowIso: string): Promise<void> {
  if (Platform.OS === 'web') return;
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
  // Marked even when permission is refused, so the hourly limit also caps how often the OS is asked.
  for (const h of fresh) watchRepo.markNotified(h.venue.venueId, nowIso);
  if (!allowed) return;
  for (const h of fresh) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: t('notif.watchTitle', { spot: h.venue.shortName, level: levelLabel(h.live.level) }), body: tn(h.live.reports, 'notif.watchBody'), data: { venueId: h.venue.venueId } },
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
      });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Ids of the focus-block notifications this process scheduled, kept in memory so they can be cancelled.
 * Memory only: after an app restart, alerts scheduled before it can no longer be cancelled from here.
 */
let sessionNotificationIds: string[] = [];

/** Cancel the focus-block notifications this process scheduled. Called on pause and end, and before every reschedule. */
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

/**
 * One local notification per remaining block boundary of the focus session. Pause cancels them
 * (cancelSessionNotifications); resume and skip call this again. Replaces any earlier schedule. Each fires at a fixed date, `now` plus the session time left until that
 * boundary: "block done", "break over", or "session done" for the last one. Nothing is scheduled for a paused,
 * ended or free-form session, with the switch off, or without permission.
 * Callers pass the app clock (nowMs) as `now`, while the OS reads the dates as device time, so with a demo
 * scenario active the alerts are off by the demo clock offset.
 * Callers: the Focus tab (start, resume, skip) and the check-in screen ("post and start a session here").
 */
export async function scheduleSessionNotifications(session: Session, now: number): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelSessionNotifications();
  if (!getState().settings.notificationsEnabled) return;
  const boundaries = remainingBoundaries(session, now);
  if (boundaries.length === 0) return;
  await configureNotifications();
  if (!(await ensurePermission())) return;
  for (const b of boundaries) {
    const title = b.last ? t('notif.sessionDone') : b.kind === 'focus' ? t('notif.blockDone', { n: b.blockNo, total: b.blocks }) : t('notif.breakOver');
    const body = b.last ? t('notif.sessionDoneBody') : b.kind === 'focus' ? t('notif.blockDoneBody') : t('notif.breakOverBody', { n: b.blockNo + 1, total: b.blocks });
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

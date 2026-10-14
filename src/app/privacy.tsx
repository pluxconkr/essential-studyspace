/**
 * S-15 Privacy · what leaves this phone and what never does. Every line here describes actual behaviour
 * in src/ — if the code changes, this screen changes with it.
 *
 * Route `/privacy`, pushed from Your week's settings. Its one control is the sharing switch
 * (`settings.shareCheckIns`, saved on the phone, on by default), the same setting the check-in form and
 * Offline data show; "Export or delete everything" opens Offline data. Where the lines are enforced:
 *   - upload body: `toReport` plus the check-in's own id (creation time and a random part), with no note,
 *     coordinates, name or device id (services/crowdClient.ts postReport);
 *   - relay: serves reports for 3 hours (RETENTION_MS, src/server/crowdStore.ts); earlier visits feed only
 *     the hourly aggregates, plus a 3-hour seen set of their ids so a re-send counts once;
 *   - GPS fix: store memory only, never saved or sent (services/location.ts);
 *   - own check-ins, notes included: pruned to CHECKIN_RETENTION_DAYS (and at most CHECKIN_RETENTION_MAX)
 *     whenever one is saved (data/repos.ts);
 *   - notifications: scheduled locally (services/notifications.ts);
 *   - demo data: simulated reports stay in memory (services/demo.ts) and check-ins made during a demo are
 *     never posted (services/refresh.ts).
 */
import { useRouter } from 'expo-router';

import { CHECKIN_RETENTION_DAYS } from '@/data/repos';
import { t } from '@/i18n';
import { actions, useAppState } from '@/store/appStore';
import { Cell, Group, SectionFooter, SectionHeader, Toggle } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';

/**
 * Three groups: Shared (the sharing switch, what one report holds and how long the relay keeps it), Never
 * shared (location, notes with their retention, focus log, preferences and free blocks, notifications,
 * demo data) and Your copy (a link to Offline data). Static text apart from the switch.
 */
export default function PrivacyScreen() {
  const router = useRouter();
  const share = useAppState((s) => s.settings.shareCheckIns);
  return (
    <Screen title={t('privacy.nav')} largeTitle={t('privacy.nav')} subtitle={t('privacy.subtitle')} testID="privacy">
      <SectionHeader>{t('privacy.shared')}</SectionHeader>
      <Group>
        <Toggle icon="share" label={t('privacy.anonymous')} value={share} onChange={(v) => actions.patchSettings({ shareCheckIns: v })} hint={t('privacy.anonymousHint')} last />
      </Group>
      <SectionFooter>{t('privacy.relayFooter')}</SectionFooter>

      <SectionHeader>{t('privacy.neverShared')}</SectionHeader>
      <Group>
        <Cell icon="location" title={t('privacy.location')} subtitle={t('privacy.locationBody')} />
        <Cell icon="document" title={t('privacy.notes')} subtitle={t('privacy.notesBody', { n: CHECKIN_RETENTION_DAYS })} />
        <Cell icon="focus" title={t('privacy.focus')} subtitle={t('privacy.focusBody')} />
        <Cell icon="settings" title={t('privacy.prefs')} subtitle={t('privacy.prefsBody')} />
        <Cell icon="bell" title={t('data.notifications')} subtitle={t('privacy.notificationsBody')} />
        <Cell icon="flask" title={t('privacy.demo')} subtitle={t('privacy.demoBody')} last />
      </Group>

      <SectionHeader>{t('privacy.yourCopy')}</SectionHeader>
      <Group>
        <Cell icon="download" title={t('privacy.export')} subtitle={t('data.nav')} accessory="chevron" onPress={() => router.push('/data')} last />
      </Group>
    </Screen>
  );
}

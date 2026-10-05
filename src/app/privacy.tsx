/**
 * S-15 Privacy · what leaves this phone and what never does. Every line here describes actual behaviour
 * in src/ — if the code changes, this screen changes with it.
 */
import { useRouter } from 'expo-router';

import { CHECKIN_RETENTION_DAYS } from '@/data/repos';
import { t } from '@/i18n';
import { actions, useAppState } from '@/store/appStore';
import { Cell, Group, SectionFooter, SectionHeader, Toggle } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';

export default function PrivacyScreen() {
  const router = useRouter();
  const share = useAppState((s) => s.settings.shareCheckIns);
  return (
    <Screen title={t('privacy.nav')} largeTitle={t('privacy.nav')} subtitle={t('privacy.subtitle')} fallback="/" testID="privacy">
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
        <Cell icon="bell" title={t('privacy.notifications')} subtitle={t('privacy.notificationsBody')} />
        <Cell icon="flask" title={t('privacy.demo')} subtitle={t('privacy.demoBody')} last />
      </Group>

      <SectionHeader>{t('privacy.yourCopy')}</SectionHeader>
      <Group>
        <Cell icon="download" title={t('privacy.export')} subtitle={t('privacy.exportSub')} accessory="chevron" onPress={() => router.push('/data')} last />
      </Group>
    </Screen>
  );
}

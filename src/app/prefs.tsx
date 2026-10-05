/**
 * S-07 Preferences editor. Draft → save → back. Cancel discards everything.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { t } from '@/i18n';
import type { Prefs } from '@/domain/types';
import { actions, useAppState } from '@/store/appStore';
import { PrefsForm } from '@/ui/PrefsForm';
import { Button } from '@/ui/primitives';
import { Screen, goBackOr } from '@/ui/Screen';

export default function PrefsScreen() {
  const router = useRouter();
  const current = useAppState((s) => s.prefs);
  const stations = useAppState((s) => s.stations);
  const [draft, setDraft] = useState<Prefs>(current);

  return (
    <Screen title={t('prefs.nav')} largeTitle={t('prefs.nav')}>
      <PrefsForm draft={draft} setDraft={setDraft} stations={stations} />

      <Button title={t('prefs.save')} onPress={() => {
        actions.savePrefs(draft);
        goBackOr(router);
      }} style={{ marginTop: 8 }} testID="prefs-save" />
      <Button title={t('common.cancel')} variant="ghost" style={{ marginTop: 6 }} onPress={() => goBackOr(router)} />
    </Screen>
  );
}

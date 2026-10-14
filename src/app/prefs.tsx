/**
 * S-07 Preferences editor. Draft → save → back. Cancel discards everything.
 *
 * Route `/prefs`, pushed from Your week's settings. Area, home station, noise preference, outlet and
 * step-free needs are edited in the `PrefsForm` shared with onboarding. Saving writes local storage via
 * `actions.savePrefs`, and the Now ranking re-derives from the new prefs. Free blocks have their own screen.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { t } from '@/i18n';
import type { Prefs } from '@/domain/types';
import { actions, useAppState } from '@/store/appStore';
import { PrefsForm } from '@/ui/PrefsForm';
import { Button } from '@/ui/primitives';
import { Screen, goBackOr } from '@/ui/Screen';

/** Edits a copy of the saved preferences taken when the screen opens; only "Save changes" writes it back. */
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

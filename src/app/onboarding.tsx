/**
 * S-00 Onboarding · where you study. One-time, ~30 seconds. No account, no email, no phone.
 * Works with no signal (a local write, nothing else). Skip → New Brunswick defaults.
 *
 * Route `/onboarding`. The root layout's `Stack.Protected` guard shows it while the onboarded flag is
 * unset (first launch, or after "Reset app data") and keeps the rest of the app behind it until then.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { DEFAULT_PREFS } from '@/data/repos';
import { t } from '@/i18n';
import type { Prefs } from '@/domain/types';
import { actions, useAppState } from '@/store/appStore';
import { PrefsForm } from '@/ui/PrefsForm';
import { Button } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';

/** The Preferences form, seeded from the stored prefs (the defaults on a fresh install), with save and skip. */
export default function OnboardingScreen() {
  const router = useRouter();
  const existing = useAppState((s) => s.prefs);
  const stations = useAppState((s) => s.stations);
  const [draft, setDraft] = useState<Prefs>(existing);

  /** Saves the prefs and the onboarded flag (which flips the root layout's guard), then opens the Now tab. */
  const finish = (p: Prefs) => {
    actions.savePrefs(p, { finishOnboarding: true });
    router.replace('/');
  };

  return (
    <Screen testID="onboarding" largeTitle={t('onboarding.title')} subtitle={t('onboarding.subtitle')}>
      <PrefsForm draft={draft} setDraft={setDraft} stations={stations} stationFooter={t('onboarding.stationFooter')} />

      <Button title={t('onboarding.save')} onPress={() => finish(draft)} testID="onboarding-save" style={{ marginTop: 8 }} />
      <Button title={t('onboarding.skip')} variant="ghost" style={{ marginTop: 6 }} onPress={() => finish(DEFAULT_PREFS)} testID="onboarding-skip" />
    </Screen>
  );
}

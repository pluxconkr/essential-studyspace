/**
 * S-00 Onboarding · where you study. One-time, ~30 seconds. No account, no email, no phone.
 * Works with no signal (local write first). Skip → New Brunswick defaults.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { DEFAULT_PREFS } from '@/data/repos';
import { AREAS, AREA_BLURB, AREA_DEFAULT_STATION, AREA_NAME } from '@/domain/areas';
import { formatModes } from '@/domain/transit';
import { t } from '@/i18n';
import type { NoisePolicy, Prefs } from '@/domain/types';
import { actions, useAppState } from '@/store/appStore';
import { Button, Cell, Group, SectionFooter, SectionHeader, Segmented, Toggle } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';

export default function OnboardingScreen() {
  const router = useRouter();
  const existing = useAppState((s) => s.prefs);
  const stations = useAppState((s) => s.stations);
  const [draft, setDraft] = useState<Prefs>({ ...DEFAULT_PREFS, ...existing });
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const areaStations = stations.filter((s) => s.area === draft.area);

  const finish = (p: Prefs) => {
    actions.savePrefs(p, { finishOnboarding: true });
    router.replace('/');
  };

  return (
    <Screen testID="onboarding" largeTitle={t('onboarding.title')} subtitle={t('onboarding.subtitle')}>
      <SectionHeader>{t('prefs.area')}</SectionHeader>
      <Group>
        {AREAS.map((a, i) => (
          <Cell key={a} icon="map" title={AREA_NAME[a]} subtitle={AREA_BLURB[a]} accessory={draft.area === a ? 'check' : 'none'} onPress={() => setDraft((d) => ({ ...d, area: a, homeStationId: AREA_DEFAULT_STATION[a] }))} accessibilityRole="button" accessibilityState={{ selected: draft.area === a }} last={i === AREAS.length - 1} />
        ))}
      </Group>

      <SectionHeader>{t('prefs.station')}</SectionHeader>
      <Group>
        {areaStations.map((s, i) => (
          <Cell key={s.stationId} icon="train" title={s.name} subtitle={formatModes(s)} accessory={draft.homeStationId === s.stationId ? 'check' : 'none'} onPress={() => set('homeStationId', s.stationId)} accessibilityRole="button" accessibilityState={{ selected: draft.homeStationId === s.stationId }} last={i === areaStations.length - 1} />
        ))}
      </Group>
      <SectionFooter>{t('onboarding.stationFooter')}</SectionFooter>

      <SectionHeader>{t('prefs.preferences')}</SectionHeader>
      <Group>
        <Cell
          icon="quiet"
          title={t('prefs.noise')}
          trailing={
            <Segmented<NoisePolicy>
              label={t('prefs.noisePref')}
              options={[
                { value: 'silent', label: t('prefs.silent') },
                { value: 'low', label: t('prefs.low') },
                { value: 'chatty', label: t('prefs.chatty') },
              ]}
              value={draft.noisePref}
              onChange={(v) => set('noisePref', v)}
            />
          }
        />
        <Toggle icon="outlet" label={t('prefs.outlet')} value={draft.needOutlets} onChange={(v) => set('needOutlets', v)} />
        <Toggle icon="accessible" label={t('prefs.stepFree')} value={draft.stepFree} onChange={(v) => set('stepFree', v)} last />
      </Group>

      <Button title={t('onboarding.save')} onPress={() => finish(draft)} testID="onboarding-save" style={{ marginTop: 8 }} />
      <Button title={t('onboarding.skip')} variant="ghost" style={{ marginTop: 6 }} onPress={() => finish({ ...DEFAULT_PREFS })} testID="onboarding-skip" />
    </Screen>
  );
}

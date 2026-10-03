/**
 * S-00 Onboarding · where you study. One-time, ~30 seconds. No account, no email, no phone.
 * Works with no signal (local write first). Skip → New Brunswick defaults.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { DEFAULT_PREFS } from '@/data/repos';
import { AREAS, AREA_BLURB, AREA_DEFAULT_STATION, AREA_NAME } from '@/domain/areas';
import { formatModes } from '@/domain/transit';
import type { Area, NoisePolicy, Prefs } from '@/domain/types';
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
    <Screen testID="onboarding" largeTitle="Where do you study?" subtitle="One time, about 30 seconds. We use this to rank spots by walking time, hours and noise. No account, no email, no phone.">
      <SectionHeader>Area</SectionHeader>
      <Group padded>
        <Segmented<Area>
          label="Area"
          options={AREAS.map((a) => ({ value: a, label: AREA_NAME[a] }))}
          value={draft.area}
          onChange={(a) => setDraft((d) => ({ ...d, area: a, homeStationId: AREA_DEFAULT_STATION[a] }))}
        />
      </Group>
      <SectionFooter>{AREA_BLURB[draft.area]}</SectionFooter>

      <SectionHeader>Your station</SectionHeader>
      <Group>
        {areaStations.map((s, i) => (
          <Cell key={s.stationId} icon="train" title={s.name} subtitle={formatModes(s)} accessory={draft.homeStationId === s.stationId ? 'check' : 'none'} onPress={() => set('homeStationId', s.stationId)} accessibilityRole="button" accessibilityState={{ selected: draft.homeStationId === s.stationId }} last={i === areaStations.length - 1} />
        ))}
      </Group>
      <SectionFooter>Walking minutes start here until the app has a GPS fix. Commuters think in minutes from the platform, so the app does too.</SectionFooter>

      <SectionHeader>How you like it</SectionHeader>
      <Group>
        <Cell
          icon="quiet"
          title="Noise"
          subtitle="Silent is the default and the point of the app"
          trailing={
            <Segmented<NoisePolicy>
              label="Noise preference"
              options={[
                { value: 'silent', label: 'Silent' },
                { value: 'low', label: 'Low' },
                { value: 'chatty', label: 'Chatty' },
              ]}
              value={draft.noisePref}
              onChange={(v) => set('noisePref', v)}
            />
          }
        />
        <Toggle icon="outlet" label="I need an outlet" value={draft.needOutlets} onChange={(v) => set('needOutlets', v)} hint="Ranks spots with power higher" />
        <Toggle icon="accessible" label="Step-free access" value={draft.stepFree} onChange={(v) => set('stepFree', v)} hint="Ranks confirmed step-free spots higher" last />
      </Group>

      <Button title="Save and continue" onPress={() => finish(draft)} testID="onboarding-save" style={{ marginTop: 8 }} />
      <Button title="Skip for now" variant="ghost" style={{ marginTop: 6 }} onPress={() => finish({ ...DEFAULT_PREFS })} testID="onboarding-skip" />
      <SectionFooter style={{ textAlign: 'center' }}>Works without a signal — saved on this phone first. Nothing leaves the phone unless you share a check-in.</SectionFooter>
    </Screen>
  );
}

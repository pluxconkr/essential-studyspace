/**
 * The preferences form shared by Onboarding and Preferences: area, home station, noise, outlets, step-free.
 * These are the ranking's inputs: which area's spots, where walks start when there is no GPS fix inside the area,
 * the noise fit and the must-haves (domain/ranking.ts). The form only edits the screen's draft; the screen saves it (actions.savePrefs).
 */
import type { Dispatch, SetStateAction } from 'react';

import { AREAS, AREA_BLURB, AREA_DEFAULT_STATION, AREA_NAME } from '@/domain/areas';
import { formatModes } from '@/domain/transit';
import type { NoisePolicy, Prefs, Station } from '@/domain/types';
import { t } from '@/i18n';

import { Cell, Group, SectionFooter, SectionHeader, Segmented, Toggle } from './primitives';

/**
 * Edits `draft` through `setDraft`. Picking an area also resets the home station to that area's default, so the
 * draft never points at a station in another area, and the station list shows only the chosen area's stations.
 * `stationFooter` goes under that list (Onboarding explains the origin).
 */
export function PrefsForm({ draft, setDraft, stations, stationFooter }: { draft: Prefs; setDraft: Dispatch<SetStateAction<Prefs>>; stations: Station[]; stationFooter?: string }) {
  /** Sets one field of the draft. */
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const areaStations = stations.filter((s) => s.area === draft.area);

  return (
    <>
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
      {stationFooter ? <SectionFooter>{stationFooter}</SectionFooter> : null}

      <SectionHeader>{t('prefs.nav')}</SectionHeader>
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
        <Toggle icon="accessible" label={t('prefs.stepFree')} value={draft.stepFree} onChange={(v) => set('stepFree', v)} hint={t('prefs.stepFreeHint')} last />
      </Group>
    </>
  );
}

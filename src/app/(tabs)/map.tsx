/**
 * S-02 Map (tab 2). Offline vector map per area with pins coloured by level (and numbered by bar
 * count, so colour is never the only channel). Zero network requests on this screen.
 *
 * The map is `AreaMap` (bundled, simplified OSM lines drawn with react-native-svg); levels come from the
 * same on-phone fusion as the Now tab (`useLiveLevels`: the level now, not on arrival). Under the map:
 * the legend, a location footer, an "All spots / Open late" layer, the tapped pin's card, and every
 * shown spot grouped by campus or town, each row pushing the spot screen.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { AREAS, AREA_NAME, AREA_SHORT, isArea } from '@/domain/areas';
import { openState, opensLate, untilLabel } from '@/domain/hours';
import { formatShort } from '@/domain/time';
import { primaryStation, walkMinutes } from '@/domain/transit';
import type { Area, Venue } from '@/domain/types';
import { t } from '@/i18n';
import { acquireLocation } from '@/services/location';
import { useAppState } from '@/store/appStore';
import { useLiveLevels, useNow, useVenues } from '@/store/derived';
import { AreaMap, MapLegend } from '@/ui/AreaMap';
import { kindIcon } from '@/ui/icons';
import { LevelLine } from '@/ui/level-widgets';
import { Button, Cell, Group, SectionFooter, SectionHeader, Segmented } from '@/ui/primitives';
import { Screen } from '@/ui/Screen';
import { GUTTER, colors } from '@/ui/theme';

/**
 * The Map tab. Shows the home area from prefs unless the area picker or an `area` deep link chose another;
 * that choice stays on this screen and is never saved. Walk times here start at each spot's primary station,
 * not at the GPS fix or home station as on the Now tab; the GPS fix is only shown (the "You" dot).
 */
export default function MapScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const venues = useVenues();
  const levels = useLiveLevels();
  const stations = useAppState((s) => s.stations);
  const prefsArea = useAppState((s) => s.prefs.area);
  const location = useAppState((s) => s.location);
  const locStatus = useAppState((s) => s.locationStatus);
  const scenario = useAppState((s) => s.settings.demoScenario);
  const now = useNow();
  // The tapped pin (venue id), shown as a card under the map; cleared when the area or layer changes.
  const [selected, setSelected] = useState<string | null>(null);
  // 'late' keeps only spots whose hours today run to 11 PM or later.
  const [layer, setLayer] = useState<'all' | 'late'>('all');
  // Deep link for demos and tests: studyspace://map?area=newark
  const { area: areaParam } = useLocalSearchParams<{ area?: string }>();
  const paramArea = isArea(areaParam) ? areaParam : null;
  // The area picked on this screen; null means the home area from prefs.
  const [areaChoice, setAreaChoice] = useState<Area | null>(paramArea);
  // A new `area` link replaces that choice. It is applied during render against the last link seen (React's
  // "adjust state when a prop changes" pattern) rather than in an effect, which react-hooks/set-state-in-effect flags.
  const [appliedParam, setAppliedParam] = useState(paramArea);
  if (paramArea !== appliedParam) {
    setAppliedParam(paramArea);
    setAreaChoice(paramArea);
  }
  const area: Area = areaChoice ?? prefsArea;

  // The same once-per-launch GPS request as the Now tab, for when the Map is the first tab opened (e.g. from a deep link).
  useEffect(() => {
    if (locStatus === 'idle') void acquireLocation();
  }, [locStatus]);

  const inArea = useMemo(() => venues.filter((v) => v.area === area), [venues, area]);
  const shown = useMemo(() => (layer === 'late' ? inArea.filter((v) => opensLate(v, now)) : inArea), [inArea, layer, now]);
  // List sections: the shown spots by campus (town when a spot has none), in directory order.
  const grouped = useMemo(() => {
    const m = new Map<string, Venue[]>();
    for (const v of shown) m.set(v.campus ?? v.town, [...(m.get(v.campus ?? v.town) ?? []), v]);
    return Array.from(m.entries());
  }, [shown]);
  // The tapped spot, or null once it is no longer shown.
  const sel = selected ? shown.find((v) => v.venueId === selected) ?? null : null;
  const mapWidth = Math.min(width - GUTTER * 2, 600);
  // Push the spot screen.
  const open = (v: Venue) => router.push({ pathname: '/spot/[id]', params: { id: v.venueId } });
  // Row subtitle: the walk from the spot's primary station (its town when it has none), then "until …" while
  // open, or "opens …" when closed.
  const sub = (v: Venue) => {
    const st = primaryStation(v, stations);
    const os = openState(v, now);
    const walk = st ? t('map.minFrom', { n: walkMinutes(st, v), station: st.name }) : v.town;
    const until = untilLabel(os);
    return os.open ? `${walk}${until ? ` · ${until}` : ''}` : t('map.opens', { walk, when: os.opensAt ? formatShort(os.opensAt) : '—' });
  };

  return (
    <Screen largeTitle={t('tab.map')} subtitle={layer === 'late' ? t('map.openLate', { n: shown.length, area: AREA_NAME[area] }) : t('map.spots', { n: shown.length, area: AREA_NAME[area] })} note={scenario !== 'live' ? t('demo.reports') : undefined} testID="map">
      <View style={styles.picker}>
        <Segmented<Area>
          label={t('prefs.area')}
          options={AREAS.map((a) => ({ value: a, label: AREA_SHORT[a] }))}
          value={area}
          onChange={(a) => {
            setAreaChoice(a);
            setSelected(null);
          }}
        />
      </View>
      <AreaMap area={area} venues={shown} levels={levels} stations={stations} location={location} selectedId={selected} onSelect={(v) => setSelected(v.venueId)} width={mapWidth} height={Math.round(mapWidth * 0.9)} />
      <MapLegend hasPosition={!!location} />
      <SectionFooter style={{ paddingHorizontal: 0 }}>{locStatus === 'denied' ? t('map.locationOff') : location ? t('map.locationNeverUploaded') : t('map.waitingFix')}</SectionFooter>
      <View style={styles.layer}>
        <Segmented<'all' | 'late'>
          label={t('map.layer')}
          options={[
            { value: 'all', label: t('map.allSpots') },
            { value: 'late', label: t('map.openLateLabel') },
          ]}
          value={layer}
          onChange={(v) => {
            setLayer(v);
            setSelected(null);
          }}
        />
      </View>
      {layer === 'late' ? <SectionFooter style={{ paddingHorizontal: 0 }}>{t('map.openLateFooter')}</SectionFooter> : null}

      {sel ? (
        <Group padded>
          <Cell icon={kindIcon(sel.kind)} title={sel.shortName} subtitle={<LevelLine live={levels[sel.venueId]} now={now} />} last />
          <Button title={t('map.openSpot')} size="sm" style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => open(sel)} />
        </Group>
      ) : null}

      {grouped.map(([campus, list]) => (
        <View key={campus}>
          <SectionHeader>{campus}</SectionHeader>
          <Group>
            {list.map((v, i) => (
              <Cell key={v.venueId} icon={kindIcon(v.kind)} iconColor={levels[v.venueId]?.open ? colors.tint : colors.ink2} title={v.shortName} subtitle={<View><LevelLine live={levels[v.venueId]} now={now} compact /><SectionFooter style={{ paddingHorizontal: 0, paddingTop: 2, paddingBottom: 0 }}>{sub(v)}</SectionFooter></View>} accessory="chevron" onPress={() => open(v)} accessibilityLabel={`${v.shortName}, ${sub(v)}`} last={i === list.length - 1} />
            ))}
          </Group>
        </View>
      ))}
      <SectionFooter>{t('map.attribution')}</SectionFooter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  picker: { marginTop: 8, marginBottom: 10 },
  layer: { marginTop: 10, marginBottom: 2 },
});

import { en } from '@/i18n/en';
import { es } from '@/i18n/es';
import { locale, setLocale, t, tlist, tn } from '@/i18n';
import { confidenceText, fuse, levelLabel, levelText } from '@/domain/levels';
import { formatDayHours, untilLabel, openState } from '@/domain/hours';
import { formatDuration, formatIn, formatMinutes, formatShort, relativeAgo, zonedToEpoch } from '@/domain/time';
import type { Venue } from '@/domain/types';
import venues from '@/assets/data/venues.json';

const alexander = (venues.venues as unknown as Venue[]).find((v) => v.venueId === 'alexander-library')!;

afterEach(() => setLocale('en'));

describe('string table', () => {
  test('Spanish defines every English key and no extras', () => {
    const missing = Object.keys(en).filter((k) => !(k in es));
    const extra = Object.keys(es).filter((k) => !(k in en));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  test('placeholders match between languages', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      const ph = (s: string) => Array.from(new Set(s.match(/\{[a-z0-9]+\}/gi) ?? [])).sort();
      expect({ k, ph: ph(es[k]) }).toEqual({ k, ph: ph(en[k]) });
    }
  });

  test('t() interpolates and falls back to English, tn() picks the plural form', () => {
    expect(t('now.closesIn', { spot: 'Carr', when: 'in 25 min' })).toBe('Carr closes in 25 min');
    expect(tn(1, 'time.hoursAgo')).toBe('1 hour ago');
    expect(tn(3, 'time.hoursAgo')).toBe('3 hours ago');
    expect(tlist('time.days')).toHaveLength(7);
    expect(setLocale('es-US')).toBe('es');
    expect(locale()).toBe('es');
    expect(t('tab.now')).toBe('Ahora');
    expect(setLocale('fr-CA')).toBe('en');
  });
});

describe('Spanish through the domain layer', () => {
  const NOW = Date.parse('2026-10-07T18:00:00Z'); // Wed 2 PM EDT

  test('levels, confidence and time words switch language without touching the numbers', () => {
    setLocale('es');
    expect(levelLabel(3)).toBe('Lleno');
    const l = fuse({ venue: alexander, reports: [{ venueId: alexander.venueId, zoneId: null, level: 3, at: new Date(NOW - 5 * 60_000).toISOString(), weight: 1 }], now: NOW });
    expect(levelText(l)).toBe('Lleno');
    expect(confidenceText(l, NOW)).toBe('1 reporte, hace 5 min');
    expect(relativeAgo(NOW - 3 * 3600_000, NOW)).toBe('hace 3 horas');
    expect(formatIn(130 * 60_000)).toBe('en 2 h 10 min');
    expect(formatDuration(14 * 3600 + 20 * 60)).toBe('14 h 20 min');
    expect(formatMinutes(14 * 60 + 30)).toBe('2:30 p. m.');
    expect(formatShort(NOW)).toBe('mié 2:00 p. m.');
    expect(formatDayHours({ open: '08:00', close: '26:00' })).toBe('8 a. m. – 2 a. m. (día siguiente)');
    expect(untilLabel(openState(alexander, zonedToEpoch('2026-10-06', 23 * 60 + 35)))).toBe('hasta las 2 a. m.');
  });

  test('English is unchanged afterwards', () => {
    expect(levelLabel(3)).toBe('Packed');
    expect(formatDuration(45 * 60)).toBe('45m');
  });
});

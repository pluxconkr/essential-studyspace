/**
 * Icons: SF Symbols on iOS (expo-symbols), Ionicons elsewhere. Always inline, never on a
 * background shape — the glyph and its tint carry the meaning.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type SymbolWeight } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

import type { Amenity, VenueKind } from '@/domain/types';

type IonName = ComponentProps<typeof Ionicons>['name'];

const ICONS = {
  now: { sf: 'location.fill', ion: 'navigate' },
  nowOutline: { sf: 'location', ion: 'navigate-outline' },
  map: { sf: 'map.fill', ion: 'map' },
  mapOutline: { sf: 'map', ion: 'map-outline' },
  focus: { sf: 'timer', ion: 'timer' },
  focusOutline: { sf: 'timer', ion: 'timer-outline' },
  library: { sf: 'building.columns.fill', ion: 'library-outline' },
  publicLibrary: { sf: 'books.vertical.fill', ion: 'book-outline' },
  studentCenter: { sf: 'building.2.fill', ion: 'business-outline' },
  cafe: { sf: 'cup.and.saucer.fill', ion: 'cafe-outline' },
  seat: { sf: 'chair.fill', ion: 'square-outline' },
  train: { sf: 'tram.fill', ion: 'train-outline' },
  walk: { sf: 'figure.walk', ion: 'walk-outline' },
  clock: { sf: 'clock', ion: 'time-outline' },
  closing: { sf: 'clock.badge.exclamationmark', ion: 'alarm-outline' },
  moon: { sf: 'moon.fill', ion: 'moon-outline' },
  outlet: { sf: 'powerplug.fill', ion: 'flash-outline' },
  wifi: { sf: 'wifi', ion: 'wifi-outline' },
  quiet: { sf: 'speaker.slash.fill', ion: 'volume-mute-outline' },
  noise: { sf: 'speaker.wave.2.fill', ion: 'volume-medium-outline' },
  group: { sf: 'person.3.fill', ion: 'people-outline' },
  solo: { sf: 'person.fill', ion: 'person-outline' },
  food: { sf: 'fork.knife', ion: 'restaurant-outline' },
  computer: { sf: 'desktopcomputer', ion: 'desktop-outline' },
  printer: { sf: 'printer.fill', ion: 'print-outline' },
  accessible: { sf: 'figure.roll', ion: 'accessibility-outline' },
  table: { sf: 'table.furniture.fill', ion: 'grid-outline' },
  checkin: { sf: 'mappin.and.ellipse', ion: 'pin-outline' },
  check: { sf: 'checkmark', ion: 'checkmark' },
  checkCircle: { sf: 'checkmark.circle.fill', ion: 'checkmark-circle' },
  circle: { sf: 'circle', ion: 'ellipse-outline' },
  chevron: { sf: 'chevron.right', ion: 'chevron-forward' },
  back: { sf: 'chevron.left', ion: 'chevron-back' },
  close: { sf: 'xmark', ion: 'close' },
  info: { sf: 'info.circle', ion: 'information-circle-outline' },
  offline: { sf: 'wifi.slash', ion: 'cloud-offline-outline' },
  download: { sf: 'arrow.down.circle', ion: 'cloud-download-outline' },
  refresh: { sf: 'arrow.clockwise', ion: 'refresh' },
  bell: { sf: 'bell.fill', ion: 'notifications-outline' },
  bellOutline: { sf: 'bell', ion: 'notifications-outline' },
  eye: { sf: 'eye.fill', ion: 'eye-outline' },
  eyeSlash: { sf: 'eye.slash.fill', ion: 'eye-off-outline' },
  shield: { sf: 'checkmark.shield.fill', ion: 'shield-checkmark-outline' },
  flask: { sf: 'function', ion: 'flask-outline' },
  star: { sf: 'star.fill', ion: 'star' },
  trash: { sf: 'trash', ion: 'trash-outline' },
  settings: { sf: 'slider.horizontal.3', ion: 'options-outline' },
  calendar: { sf: 'calendar', ion: 'calendar-outline' },
  flame: { sf: 'flame.fill', ion: 'flame-outline' },
  chart: { sf: 'chart.bar.fill', ion: 'bar-chart-outline' },
  target: { sf: 'target', ion: 'locate-outline' },
  play: { sf: 'play.fill', ion: 'play' },
  pause: { sf: 'pause.fill', ion: 'pause' },
  stop: { sf: 'stop.fill', ion: 'stop' },
  forward: { sf: 'forward.end.fill', ion: 'play-skip-forward' },
  plus: { sf: 'plus', ion: 'add' },
  minus: { sf: 'minus', ion: 'remove' },
  goals: { sf: 'checklist', ion: 'list' },
  history: { sf: 'clock.arrow.circlepath', ion: 'time-outline' },
  lock: { sf: 'lock.fill', ion: 'lock-closed-outline' },
  question: { sf: 'questionmark.circle', ion: 'help-circle-outline' },
  phone: { sf: 'phone.fill', ion: 'call' },
  link: { sf: 'safari', ion: 'globe-outline' },
  school: { sf: 'graduationcap.fill', ion: 'school-outline' },
  alert: { sf: 'exclamationmark.triangle.fill', ion: 'warning' },
  location: { sf: 'location.fill', ion: 'navigate' },
  locationOff: { sf: 'location.slash', ion: 'navigate-outline' },
  pin: { sf: 'mappin', ion: 'location-outline' },
  sparkle: { sf: 'sparkles', ion: 'sparkles-outline' },
  document: { sf: 'doc.text', ion: 'document-text-outline' },
  share: { sf: 'antenna.radiowaves.left.and.right', ion: 'radio-outline' },
  gap: { sf: 'hourglass', ion: 'hourglass-outline' },
} as const satisfies Record<string, { sf: string; ion: IonName }>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = '#0B0F19', weight = 'medium', style }: { name: IconName; size?: number; color?: string; weight?: SymbolWeight; style?: StyleProp<ViewStyle> }) {
  const def = ICONS[name];
  const fallback = <Ionicons name={def.ion} size={size} color={color} />;
  if (Platform.OS !== 'ios') return fallback;
  return <SymbolView name={def.sf as never} size={size} tintColor={color} weight={weight} resizeMode="scaleAspectFit" style={[{ width: size, height: size }, style]} fallback={fallback} />;
}

export function kindIcon(kind: VenueKind): IconName {
  switch (kind) {
    case 'library':
      return 'library';
    case 'public-library':
      return 'publicLibrary';
    case 'student-center':
      return 'studentCenter';
    default:
      return 'cafe';
  }
}

export function amenityIcon(a: Amenity): IconName {
  switch (a) {
    case 'outlets':
      return 'outlet';
    case 'wifi-eduroam':
    case 'wifi-public':
      return 'wifi';
    case 'group-rooms':
      return 'group';
    case 'computers':
      return 'computer';
    case 'printing':
      return 'printer';
    case 'cafe':
    case 'food-nearby':
      return 'food';
    case 'late-night':
      return 'moon';
    case 'solo-desks':
      return 'solo';
    default:
      return 'table';
  }
}

export const AMENITY_LABEL: Record<Amenity, string> = {
  outlets: 'Outlets',
  'wifi-eduroam': 'eduroam wifi',
  'wifi-public': 'Public wifi',
  'group-rooms': 'Group rooms',
  computers: 'Computers',
  printing: 'Printing',
  cafe: 'Café inside',
  'food-nearby': 'Food nearby',
  'late-night': 'Open late',
  'solo-desks': 'Solo desks',
  'big-tables': 'Big tables',
};

/**
 * Screen scaffolds in the iOS idiom.
 *  - OFFLINE banner: never hidden while offline.
 *  - Tab screens: large title with a one-line status under it.
 *  - Sub screens: compact nav bar with back chevron; optional large title below.
 */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { relativeAgo } from '@/domain/time';
import { isOfflineNow, useAppState } from '@/store/appStore';
import { useRealNow } from '@/store/derived';

import { Icon } from './icons';
import { GUTTER, MIN_TAP, colors, type } from './theme';

type Router = ReturnType<typeof useRouter>;
export type Fallback = '/' | '/map' | '/focus';

/** Go back if there is history; otherwise replace with a sensible fallback (deep links, tests). */
export function goBackOr(router: Router, fallback: Fallback = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

export function OfflineBanner() {
  const offline = useAppState((s) => isOfflineNow(s));
  const simulated = useAppState((s) => s.settings.simulateOffline);
  if (!offline) return null;
  return (
    <View style={styles.offline} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name="offline" size={14} color={colors.offlineText} weight="semibold" />
      <Text maxFontSizeMultiplier={1.4} style={styles.offlineText}>
        OFFLINE MODE · saved hours, typical pattern, your own check-ins{simulated ? ' · simulated' : ''}
      </Text>
    </View>
  );
}

/** One-line status under a tab title: online/offline and the last live-level check. */
export function StatusLine() {
  const offline = useAppState((s) => isOfflineNow(s));
  const checked = useAppState((s) => s.cacheMeta.crowd?.fetchedAt ?? null);
  const configured = useAppState((s) => s.crowd?.configured ?? true);
  const refreshing = useAppState((s) => s.refreshing);
  const demo = useAppState((s) => s.settings.demoScenario !== 'live');
  const realNow = useRealNow();
  const text = refreshing
    ? 'Checking live levels…'
    : offline
      ? 'No signal · saved hours and typical pattern'
      : checked
        ? `Live levels checked ${relativeAgo(checked, realNow)}${configured ? '' : ' · dev relay'}`
        : 'Live levels not checked yet · typical pattern';
  return <Text style={styles.status}>{demo ? `${text} · demo` : text}</Text>;
}

export function BackHeader({ title, right, fallback = '/' }: { title: string; right?: ReactNode; fallback?: Fallback }) {
  const router = useRouter();
  return (
    <View style={styles.navBar}>
      <Pressable onPress={() => goBackOr(router, fallback)} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.5 }]}>
        <Icon name="back" size={22} color={colors.tint} weight="semibold" />
        <Text maxFontSizeMultiplier={1.3} style={styles.backText}>Back</Text>
      </Pressable>
      <Text maxFontSizeMultiplier={1.3} style={styles.navTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.navRight}>{right}</View>
    </View>
  );
}

export function Screen({
  children,
  title,
  largeTitle,
  subtitle,
  note,
  status,
  header,
  headerRight,
  contentStyle,
  padded = true,
  scroll = true,
  testID,
  fallback,
}: {
  children: ReactNode;
  /** Sub-screen nav bar title (renders a back button). */
  title?: string;
  /** Large page title (tab screens or sub-screens). */
  largeTitle?: string;
  subtitle?: string;
  /** Footnote under the subtitle, e.g. the demo label. */
  note?: string;
  /** Show the live-level status line under the large title. */
  status?: boolean;
  /** Full-bleed element rendered above the body. */
  header?: ReactNode;
  headerRight?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
  scroll?: boolean;
  testID?: string;
  fallback?: Fallback;
}) {
  const insets = useSafeAreaInsets();
  const pageHeader = largeTitle ? (
    <View style={[styles.pageHeader, !title && { paddingTop: 8 }]}>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.5} style={type.largeTitle} accessibilityRole="header">
          {largeTitle}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {note ? <Text style={styles.status}>{note}</Text> : null}
        {status ? <StatusLine /> : null}
      </View>
      {headerRight ? <View style={{ paddingBottom: 6 }}>{headerRight}</View> : null}
    </View>
  ) : null;
  const body = <View style={[padded && styles.padded, contentStyle]}>{children}</View>;
  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID={testID}>
      <OfflineBanner />
      {title ? <BackHeader title={largeTitle === title ? '' : title} fallback={fallback} /> : null}
      {scroll ? (
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never">
          {header}
          {pageHeader}
          {body}
        </ScrollView>
      ) : (
        <View style={styles.scroll}>
          {header}
          {pageHeader}
          {body}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  padded: { paddingHorizontal: GUTTER },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.offlineBar, paddingVertical: 7, paddingHorizontal: 12 },
  offlineText: { color: colors.offlineText, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  pageHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: GUTTER, paddingTop: 2, paddingBottom: 8 },
  subtitle: { ...type.subheadline, marginTop: 4 },
  status: { ...type.footnote, marginTop: 3 },
  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: MIN_TAP },
  backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP, paddingRight: 8, minWidth: 84, gap: 2 },
  backText: { fontSize: 17, color: colors.tint, letterSpacing: -0.41 },
  navTitle: { flex: 1, textAlign: 'center', ...type.headline },
  navRight: { minWidth: 84, alignItems: 'flex-end', paddingRight: 8 },
});

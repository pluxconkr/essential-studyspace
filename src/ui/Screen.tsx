/**
 * Screen scaffolds in the iOS idiom. Every screen in src/app (all but the layouts and the api routes) renders inside `Screen`.
 *  - OFFLINE banner: never hidden while offline (every Screen draws it above everything else).
 *  - Tab screens: large title with a subtitle or note; the Now tab adds the one-line live-level status and pull-to-refresh.
 *  - Sub screens: compact nav bar with back chevron; optional large title below.
 */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { relativeAgo } from '@/domain/time';
import { t } from '@/i18n';
import { isOfflineNow, useAppState } from '@/store/appStore';
import { useRealNow } from '@/store/derived';

import { Icon } from './icons';
import { GUTTER, MIN_TAP, colors, type } from './theme';

/** The expo-router router object, as returned by useRouter(). */
type Router = ReturnType<typeof useRouter>;
/**
 * Go back if there is history; otherwise go home (deep links, tests). Used by the Back button and by sub-screens
 * that close themselves: Save / Cancel on Preferences, Close / Done on "Why this ranking?", and after posting a
 * check-in or an earlier-visit report.
 */
export function goBackOr(router: Router) {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Grey "OFFLINE MODE · saved hours and your check-ins" bar, shown while the network is known to be down or the demo
 * "Simulate no signal" switch is on (then suffixed "· simulated"). Renders nothing online or while the network
 * state is still unknown at launch (isOfflineNow). Carries the alert accessibility role and a polite live region.
 */
export function OfflineBanner() {
  const offline = useAppState((s) => isOfflineNow(s));
  const simulated = useAppState((s) => s.settings.simulateOffline);
  if (!offline) return null;
  return (
    <View style={styles.offline} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name="offline" size={14} color={colors.offlineText} weight="semibold" />
      <Text maxFontSizeMultiplier={1.4} style={styles.offlineText}>
        {t('offline.banner')}
        {simulated ? t('offline.simulated') : ''}
      </Text>
    </View>
  );
}

/**
 * One-line status under a tab title: online/offline and the last live-level check.
 * In order: "Checking live levels…" while refreshing, "No signal · saved hours and typical pattern",
 * "Live levels checked 5 min ago", or "Typical pattern · live levels not checked yet". The age uses the device
 * clock (useRealNow), not the demo clock, because the crowd cache's fetchedAt is a device timestamp.
 */
export function StatusLine() {
  const offline = useAppState((s) => isOfflineNow(s));
  const checked = useAppState((s) => s.cacheMeta.crowd?.fetchedAt ?? null);
  const refreshing = useAppState((s) => s.refreshing);
  const realNow = useRealNow();
  const text = refreshing ? t('status.checking') : offline ? t('status.offline') : checked ? t('status.checked', { ago: relativeAgo(checked, realNow) }) : t('status.notYet');
  return <Text style={styles.status}>{text}</Text>;
}

/** Compact nav bar: "‹ Back" (goBackOr), a centred one-line title and an optional right-hand slot. */
export function BackHeader({ title, right }: { title: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.navBar}>
      <Pressable onPress={() => goBackOr(router)} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.5 }]}>
        <Icon name="back" size={22} color={colors.tint} weight="semibold" />
        <Text maxFontSizeMultiplier={1.3} style={styles.backText}>{t('common.back')}</Text>
      </Pressable>
      <Text maxFontSizeMultiplier={1.3} style={styles.navTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.navRight}>{right}</View>
    </View>
  );
}

/**
 * The page every screen renders inside: safe-area top inset, OFFLINE banner, optional nav bar, then a scroll
 * view holding the large-title header and `children` inset by the page gutter. Buttons take a tap while the
 * keyboard is up (goal and note fields), instead of the first tap only dismissing it.
 */
export function Screen({
  children,
  title,
  largeTitle,
  subtitle,
  note,
  status,
  testID,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  /** Sub-screen nav bar title (renders a back button). Left blank in the bar when it equals `largeTitle`, so the words are not shown twice. */
  title?: string;
  /** Large page title (tab screens or sub-screens). */
  largeTitle?: string;
  subtitle?: string;
  /** Footnote under the subtitle, e.g. the demo label. */
  note?: string;
  /** Show the live-level status line under the large title. */
  status?: boolean;
  testID?: string;
  /** Pull-to-refresh handler (tab screens). */
  onRefresh?: () => void;
  /** Keeps the pull-to-refresh indicator showing while a refresh runs. */
  refreshing?: boolean;
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
    </View>
  ) : null;
  const body = <View style={styles.padded}>{children}</View>;
  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID={testID}>
      <OfflineBanner />
      {title ? <BackHeader title={largeTitle === title ? '' : title} /> : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink2} /> : undefined}>
        {pageHeader}
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  padded: { paddingHorizontal: GUTTER },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.offlineBar, paddingVertical: 7, paddingHorizontal: 12 },
  offlineText: { ...type.caption, color: colors.offlineText, fontWeight: type.headline.fontWeight },
  pageHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: GUTTER, paddingTop: 2, paddingBottom: 8 },
  subtitle: { ...type.subheadline, marginTop: 4 },
  status: { ...type.footnote, marginTop: 3 },
  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: MIN_TAP },
  backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP, paddingRight: 8, minWidth: 84, gap: 2 },
  backText: { ...type.body, color: colors.tint },
  navTitle: { flex: 1, textAlign: 'center', ...type.headline },
  navRight: { minWidth: 84, alignItems: 'flex-end', paddingRight: 8 },
});

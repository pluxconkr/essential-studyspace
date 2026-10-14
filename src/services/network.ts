/**
 * Network state → store. Offline is a state, not an error.
 * The store's `network.online` is true, false, or null while unknown. isOfflineNow() combines it with the
 * "Simulate no signal" switch, and that is what the refresh steps and the offline banner read. Started once at
 * boot by the root layout, which refreshes stale data whenever this reports online.
 */
import * as Network from 'expo-network';
import { Platform } from 'react-native';

import { actions, type NetworkInfo } from '@/store/appStore';

/**
 * An expo-network reading as the store's NetworkInfo. Web trusts navigator.onLine (online when there is no
 * navigator). Native: offline as soon as the OS says not connected or internet unreachable; unknown (null) when
 * it reports neither. Unknown never counts as offline (isOfflineNow).
 */
export function toNetworkInfo(s: Network.NetworkState): NetworkInfo {
  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    return { online: nav ? nav.onLine : true, type: s.type ?? null };
  }
  if (s.isConnected === undefined && s.isInternetReachable === undefined) return { online: null, type: s.type ?? null };
  const offline = s.isConnected === false || s.isInternetReachable === false;
  return { online: !offline, type: s.type ?? null };
}

/** The single OS connectivity listener while watching (null otherwise), so repeated starts never stack listeners. */
let subscription: { remove: () => void } | null = null;

/**
 * Start watching connectivity. Idempotent. Returns a stop function.
 * Reads the state once now and on every change, writes it to the store and passes it to `onChange`. A second call
 * re-reads the state (passing that one reading to its own `onChange`) but keeps the first listener, so later
 * changes still go to the first `onChange` only. If the read fails, online is set to unknown and `onChange` is
 * not called. Any returned stop function removes the shared listener, so a later start adds a new one.
 */
export function startNetworkWatch(onChange?: (info: NetworkInfo) => void): () => void {
  Network.getNetworkStateAsync()
    .then((s) => {
      const info = toNetworkInfo(s);
      actions.setNetwork(info);
      onChange?.(info);
    })
    .catch(() => actions.setNetwork({ online: null, type: null }));
  if (!subscription) {
    subscription = Network.addNetworkStateListener((s) => {
      const info = toNetworkInfo(s);
      actions.setNetwork(info);
      onChange?.(info);
    });
  }
  return () => {
    subscription?.remove();
    subscription = null;
  };
}

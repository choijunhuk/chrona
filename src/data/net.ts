/**
 * 온라인 상태 (stage-1 §1-9).
 * 읽기: persist 캐시로 오프라인 동작. 쓰기: 오프라인이면 차단 + 안내.
 */
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { ToastAndroid } from 'react-native';
import { create } from 'zustand';

type NetState = {
  isOnline: boolean;
};

export const useNetStore = create<NetState>(() => ({
  isOnline: true,
}));

/** 앱 루트에서 1회 호출. TanStack onlineManager도 여기서 연결 (재연결 시 자동 refetch) */
export function initNetListener(): () => void {
  return NetInfo.addEventListener((state) => {
    // isInternetReachable이 확정되면 그 값을 우선 (Wi-Fi 연결됐지만 인터넷 없는 상태 구분)
    const online = state.isInternetReachable ?? !!state.isConnected;
    useNetStore.setState({ isOnline: online });
    onlineManager.setOnline(online);
  });
}

/** mutation 앞단 가드. 오프라인이면 토스트 + throw (stage-1 §1-9: 오프라인 쓰기 큐 없음) */
export function assertOnline(): void {
  if (!useNetStore.getState().isOnline) {
    ToastAndroid.show('오프라인 상태입니다. 연결 후 다시 시도하세요.', ToastAndroid.SHORT);
    throw new Error('offline');
  }
}

/**
 * mutation 실패 토스트 (stage-13). 실패를 조용히 삼키지 않는다.
 * 오프라인은 assertOnline이 이미 안내했으므로 중복 토스트를 내지 않는다.
 */
export function toastMutationError(e: unknown, prefix = '저장 실패'): void {
  if (String(e) === 'Error: offline') return;
  ToastAndroid.show(`${prefix}: ${String(e)}`, ToastAndroid.LONG);
}

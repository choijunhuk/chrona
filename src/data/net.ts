/**
 * 온라인 상태 (stage-1 §1-9).
 * 읽기: persist 캐시로 오프라인 동작. 쓰기: 오프라인이면 차단 + 안내.
 */
import NetInfo from '@react-native-community/netinfo';
import { ToastAndroid } from 'react-native';
import { create } from 'zustand';

type NetState = {
  isOnline: boolean;
};

export const useNetStore = create<NetState>(() => ({
  isOnline: true,
}));

/** 앱 루트에서 1회 호출 */
export function initNetListener(): () => void {
  return NetInfo.addEventListener((state) => {
    useNetStore.setState({ isOnline: !!state.isConnected });
  });
}

/** mutation 앞단 가드. 오프라인이면 토스트 + throw (stage-1 §1-9: 오프라인 쓰기 큐 없음) */
export function assertOnline(): void {
  if (!useNetStore.getState().isOnline) {
    ToastAndroid.show('오프라인 상태입니다. 연결 후 다시 시도하세요.', ToastAndroid.SHORT);
    throw new Error('offline');
  }
}

/**
 * 삼성 권한 상태 관리 (master §4.1·§4.2, stage-3 §1-8·1-9).
 * 1~4번은 API 확인, 5·6번은 수동 확인(체크 시각을 로컬에 기록).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IntentLauncher from 'expo-intent-launcher';
import { create } from 'zustand';

import { getPermissionSnapshot } from '@/native/alarm';

const MANUAL_KEY = 'chrona.manual-permission-checks';
const PKG = 'com.choi.chrona';

export type ManualChecks = {
  unusedAppSleep: string | null; // ISO — 확인한 시각
  autoOptimization: string | null;
};

export type PermissionHealth = {
  notifications: boolean;
  exactAlarm: boolean;
  batteryUnrestricted: boolean;
  checkedAt: string;
};

type PermissionState = {
  broken: boolean; // 1~4 중 하나라도 깨짐 → 경고 배너
  setBroken: (b: boolean) => void;
};

export const usePermissionStore = create<PermissionState>((set) => ({
  broken: false,
  setBroken: (broken) => set({ broken }),
}));

/** 1~4번 API 확인 (전체화면은 API 없음 — 수동) */
export async function checkPermissionHealth(): Promise<PermissionHealth> {
  const s = await getPermissionSnapshot();
  return {
    notifications: s.notifications === '허용됨',
    exactAlarm: s.exactAlarm !== '거부됨 — 설정 필요',
    batteryUnrestricted: !s.batteryOptimizationEnabled,
    checkedAt: new Date().toISOString(),
  };
}

export function isHealthy(h: PermissionHealth): boolean {
  return h.notifications && h.exactAlarm && h.batteryUnrestricted;
}

export async function readManualChecks(): Promise<ManualChecks> {
  try {
    const raw = await AsyncStorage.getItem(MANUAL_KEY);
    return raw ? JSON.parse(raw) : { unusedAppSleep: null, autoOptimization: null };
  } catch {
    return { unusedAppSleep: null, autoOptimization: null };
  }
}

export async function setManualCheck(key: keyof ManualChecks): Promise<ManualChecks> {
  const cur = await readManualChecks();
  const next = { ...cur, [key]: new Date().toISOString() };
  await AsyncStorage.setItem(MANUAL_KEY, JSON.stringify(next));
  return next;
}

const CHECKED_KEY = 'chrona.perm-checked-at';

/** 앱 포그라운드 진입 시: 7일 지났으면 1~4 재확인 (master §4.2) */
export async function maybeWeeklyCheck(): Promise<void> {
  try {
    const last = await AsyncStorage.getItem(CHECKED_KEY);
    const stale = !last || Date.now() - new Date(last).getTime() > 7 * 86400_000;
    if (!stale) return;
    const h = await checkPermissionHealth();
    usePermissionStore.getState().setBroken(!isHealthy(h));
    if (isHealthy(h)) {
      await AsyncStorage.setItem(CHECKED_KEY, new Date().toISOString());
    }
  } catch {
    /* 확인 실패는 조용히 — 다음 진입에 재시도 */
  }
}

/** 온보딩에서 수동 새로고침 후 호출 — 확인 시각 기록 */
export async function recordPermissionCheck(): Promise<void> {
  await AsyncStorage.setItem(CHECKED_KEY, new Date().toISOString());
}

/** 전체화면 알림 설정 화면 (Android 14+) */
export async function openFullScreenIntentSettings(): Promise<void> {
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT',
      { data: `package:${PKG}` }
    );
  } catch {
    // 미지원 기기 → 앱 알림 설정으로 폴백
    await IntentLauncher.startActivityAsync('android.settings.APP_NOTIFICATION_SETTINGS', {
      extra: { 'android.provider.extra.APP_PACKAGE': PKG },
    });
  }
}

/** 배터리 설정 (미사용 앱 절전 목록으로 가는 가장 가까운 화면) */
export async function openBatteryMenu(): Promise<void> {
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.POWER_USAGE_SUMMARY');
  } catch {
    await IntentLauncher.startActivityAsync('android.settings.BATTERY_SAVER_SETTINGS');
  }
}

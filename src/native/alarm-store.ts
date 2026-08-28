/**
 * 디버그 화면용 테스트 알람 기록 (Stage 0 잔재).
 * 실제 부팅 복구는 rescheduler.ts의 전체 재계산이 담당한다 (마스터 §3.7).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AlarmPayload } from '@/domain/alarm-payload';

const KEY = 'chrona.scheduled-test-alarms';

type StoredAlarm = {
  notificationId: string;
  fireAt: string; // ISO
  payload: AlarmPayload;
};

async function readAll(): Promise<StoredAlarm[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredAlarm[]) : [];
  } catch {
    return [];
  }
}

export async function rememberScheduled(
  notificationId: string,
  fireAt: Date,
  payload: AlarmPayload
): Promise<void> {
  const all = await readAll();
  all.push({ notificationId, fireAt: fireAt.toISOString(), payload });
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}

export async function clearRemembered(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

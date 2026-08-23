/**
 * 부팅 복구용 로컬 기록 (Stage 0 §1-8).
 *
 * Notifee가 자체적으로 재부팅 후 트리거를 복원하지만, Stage 0에서는
 * "예약했던 테스트 알람이 재부팅 후에도 남아있는가"를 검증해야 하므로
 * 예약 내역을 AsyncStorage에 남기고 앱 시작 시 대조·복구한다.
 * Stage 3에서 이 자리가 실제 재계산 로직으로 교체된다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AlarmPayload } from '@/domain/alarm-payload';
import { listScheduled, scheduleAlarm } from '@/native/alarm';

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

/**
 * 앱 시작 시 호출: 미래 시각인데 예약 목록에 없는 알람을 재예약.
 * TODO(Stage 3): BOOT_COMPLETED 시 rrule 기반 30건 재계산으로 교체 (마스터 §3.7)
 */
export async function restoreMissingAlarms(): Promise<number> {
  const remembered = await readAll();
  const now = Date.now();
  const future = remembered.filter((a) => new Date(a.fireAt).getTime() > now);

  // 과거 항목은 정리
  if (future.length !== remembered.length) {
    await AsyncStorage.setItem(KEY, JSON.stringify(future));
  }
  if (future.length === 0) return 0;

  const scheduled = await listScheduled();
  const scheduledIds = new Set(scheduled.map((s) => s.id));
  let restored = 0;
  for (const a of future) {
    if (!scheduledIds.has(a.notificationId)) {
      await scheduleAlarm(a.payload, new Date(a.fireAt));
      restored += 1;
    }
  }
  if (restored > 0) {
    console.log(`[chrona] boot recovery: restored ${restored} alarm(s)`);
  }
  return restored;
}

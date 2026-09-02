/**
 * 마지막 재계산 결과 요약 캐시 (stage-13).
 * 홈 "다음 알람 · 이번만 건너뛰기" 칩이 DB 재전개 없이 읽는다. rescheduler가 쓰고 UI가 읽는다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PlannedAlarm } from '@/domain/schedule';

const KEY = 'chrona.planned-cache';

export type PlannedSummary = {
  key: string; // domain alarmKey(payload)
  fireAt: string; // ISO
  title: string;
  timeLabel: string;
  mode: 'notify' | 'alarm';
  eventId: string;
};

type Listener = (items: PlannedSummary[]) => void;
const listeners = new Set<Listener>();
let cache: PlannedSummary[] = [];

export async function writePlannedCache(planned: PlannedAlarm[], alarmKey: (p: PlannedAlarm['payload']) => string) {
  cache = planned.slice(0, 10).map((p) => ({
    key: alarmKey(p.payload),
    fireAt: p.fireAt.toISOString(),
    title: p.payload.title,
    timeLabel: p.payload.timeLabel,
    mode: p.mode,
    eventId: p.payload.eventId,
  }));
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* headless에서 실패해도 알람 예약과 무관 */
  }
  listeners.forEach((l) => l(cache));
}

export async function readPlannedCache(): Promise<PlannedSummary[]> {
  if (cache.length) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as PlannedSummary[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function subscribePlannedCache(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

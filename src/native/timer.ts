/**
 * 집중 타이머 (stage-6 §1).
 *
 * 진실은 "시작 시각"뿐 — 남은 시간은 항상 endAt - now로 계산한다 (DoD).
 * 알림창 카운트다운은 Android 네이티브 chronometer가 그린다 → JS 갱신 0회,
 * 백그라운드/화면 꺼짐에도 정확 (10초 주기 갱신 규정보다 나은 방식 — 배터리 0).
 * 완료 알람은 트리거 예약 (앱이 죽어도 울림).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  cancelTimerNotifications,
  scheduleTimerComplete,
  showTimerOngoing,
} from '@/native/alarm';
import { supabase } from '@/data/supabase';

const KEY = 'chrona.timer-state';

export type TimerState = {
  startedAt: number; // epoch ms
  endAt: number;
  plannedMinutes: number;
  pausedAt: number | null; // 일시정지 시각 (null = 진행 중)
  eventId: string | null;
  title: string | null;
};

type TimerStore = {
  timer: TimerState | null;
  set: (t: TimerState | null) => void;
};

export const useTimerStore = create<TimerStore>((set) => ({
  timer: null,
  set: (timer) => set({ timer }),
}));

async function persist(t: TimerState | null): Promise<void> {
  if (t) await AsyncStorage.setItem(KEY, JSON.stringify(t));
  else await AsyncStorage.removeItem(KEY);
  useTimerStore.getState().set(t);
}

/** 앱 시작 시 복원 (진행 중이던 타이머) */
export async function restoreTimer(): Promise<TimerState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const t = raw ? (JSON.parse(raw) as TimerState) : null;
    if (t && t.pausedAt === null && t.endAt <= Date.now()) {
      // 자는 동안 완료됨 — 세션 기록 후 정리
      await finishTimer(true);
      return null;
    }
    useTimerStore.getState().set(t);
    return t;
  } catch {
    return null;
  }
}

export async function startTimer(opts: {
  minutes: number;
  eventId?: string | null;
  title?: string | null;
}): Promise<void> {
  const now = Date.now();
  const t: TimerState = {
    startedAt: now,
    endAt: now + opts.minutes * 60_000,
    plannedMinutes: opts.minutes,
    pausedAt: null,
    eventId: opts.eventId ?? null,
    title: opts.title ?? null,
  };
  await persist(t);
  await showTimerOngoing(t.title ?? '집중 중', new Date(t.endAt), false);
  await scheduleTimerComplete(new Date(t.endAt), t.title ?? '집중 완료');
}

export async function pauseTimer(): Promise<void> {
  const t = useTimerStore.getState().timer;
  if (!t || t.pausedAt !== null) return;
  const paused: TimerState = { ...t, pausedAt: Date.now() };
  await persist(paused);
  await cancelTimerNotifications();
  await showTimerOngoing(paused.title ?? '집중 일시정지', new Date(paused.endAt), true);
}

export async function resumeTimer(): Promise<void> {
  const t = useTimerStore.getState().timer;
  if (!t || t.pausedAt === null) return;
  const shift = Date.now() - t.pausedAt;
  const resumed: TimerState = { ...t, endAt: t.endAt + shift, pausedAt: null };
  await persist(resumed);
  await cancelTimerNotifications();
  await showTimerOngoing(resumed.title ?? '집중 중', new Date(resumed.endAt), false);
  await scheduleTimerComplete(new Date(resumed.endAt), resumed.title ?? '집중 완료');
}

/** 종료 (완료/중도 공통 — completed 플래그로 구분해 focus_sessions 기록) */
export async function finishTimer(completed: boolean): Promise<void> {
  const raw = await AsyncStorage.getItem(KEY);
  const t: TimerState | null = raw ? JSON.parse(raw) : useTimerStore.getState().timer;
  await persist(null);
  await cancelTimerNotifications();
  if (!t) return;
  try {
    const { data: s } = await supabase.auth.getSession();
    if (s.session) {
      await supabase.from('focus_sessions').insert({
        user_id: s.session.user.id,
        event_id: t.eventId,
        started_at: new Date(t.startedAt).toISOString(),
        ended_at: new Date().toISOString(),
        planned_minutes: t.plannedMinutes,
        completed,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn('[chrona] focus session record failed:', e);
  }
}

export function remainingMs(t: TimerState, now: number): number {
  const base = t.pausedAt !== null ? t.pausedAt : now;
  return Math.max(0, t.endAt - base);
}

export function formatMMSS(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s0 = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s0).padStart(2, '0')}`;
}

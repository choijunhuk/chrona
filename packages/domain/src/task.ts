/**
 * 과제 D-day 계산 — 순수 TS (stage-4 §1-1).
 * D-day는 "날짜 차이"로 계산한다. 시각까지 계산하면 "D-1인데 23시간 남음"처럼 어긋난다.
 */
import { fromDateOnly, toDateOnly } from './time';

/** 마감까지 남은 일수 (날짜 기준, 시각 무시). 오늘 마감=0, 지남=음수 */
export function daysUntilDue(dueAt: Date, now: Date, tz: string): number {
  const dueDay = fromDateOnly(toDateOnly(dueAt, tz), tz);
  const today = fromDateOnly(toDateOnly(now, tz), tz);
  return Math.round((dueDay.getTime() - today.getTime()) / 86400_000);
}

export type DueUrgency = 'overdue' | 'today' | 'soon' | 'normal';

export function dueUrgency(days: number): DueUrgency {
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'normal';
}

export function dDayLabel(days: number): string {
  if (days === 0) return 'D-DAY';
  if (days < 0) return `D+${-days}`;
  return `D-${days}`;
}

/**
 * 계단식 알림 기본 3단계 (stage-4 §1-2). 상수 고정 — 설정화하지 않는다.
 * offset_minutes는 due_at 기준 (stage-3 §1-2).
 */
export const TASK_REMINDER_STEPS = [
  { label: '3일 전', offsetMinutes: 3 * 24 * 60 },
  { label: '1일 전', offsetMinutes: 24 * 60 },
  { label: '3시간 전', offsetMinutes: 3 * 60 },
] as const;

/** 이미 지난 단계는 제외한 계단식 offset 목록 (stage-4 §1-2) */
export function applicableTaskSteps(
  dueAt: Date,
  now: Date
): { label: string; offsetMinutes: number }[] {
  return TASK_REMINDER_STEPS.filter(
    (s) => dueAt.getTime() - s.offsetMinutes * 60_000 > now.getTime()
  ).map((s) => ({ label: s.label, offsetMinutes: s.offsetMinutes }));
}

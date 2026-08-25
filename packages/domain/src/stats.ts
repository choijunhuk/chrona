/**
 * 통계 집계 — 순수 TS (stage-7 §2-1). UI는 그리기만 한다.
 */
import { toDateOnly, type DateOnly } from './time';
import type { Category, ChronaEvent, FocusSession } from './types';

/** 통계 입력용 회차 (전개·override 반영 후) */
export type StatOccurrence = {
  categoryId: string | null;
  start: Date;
  end: Date | null;
};

export type CategorySlice = {
  categoryId: string | null;
  name: string;
  color: string | null;
  minutes: number;
};

/** 주간 카테고리별 시간 배분 (stage-7 §1-1) */
export function weeklyCategoryBreakdown(
  occurrences: StatOccurrence[],
  categories: Category[],
  range: { from: Date; to: Date }
): CategorySlice[] {
  const byCat = new Map<string | null, number>();
  for (const o of occurrences) {
    if (!o.end) continue; // duration 없는 항목 제외
    if (o.start < range.from || o.start > range.to) continue;
    const min = Math.max(0, (o.end.getTime() - o.start.getTime()) / 60_000);
    byCat.set(o.categoryId, (byCat.get(o.categoryId) ?? 0) + min);
  }
  const catMap = new Map(categories.map((c) => [c.id, c]));
  return [...byCat.entries()]
    .map(([categoryId, minutes]) => ({
      categoryId,
      name: categoryId ? (catMap.get(categoryId)?.name ?? '기타') : '미분류',
      color: categoryId ? (catMap.get(categoryId)?.color ?? null) : null,
      minutes: Math.round(minutes),
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

export type DailyComparison = {
  date: DateOnly;
  plannedMinutes: number;
  actualMinutes: number;
};

/** 계획(일정 duration) vs 실제(집중 세션) — 요일별 (stage-7 §1-2)
 *  자정 걸친 세션은 시작일 기준 귀속 (검증 7) */
export function plannedVsActual(
  occurrences: StatOccurrence[],
  sessions: FocusSession[],
  days: DateOnly[], // 주의 7일 (주 시작 요일 설정 반영은 호출측)
  tz: string
): DailyComparison[] {
  const planned = new Map<string, number>();
  const actual = new Map<string, number>();
  for (const o of occurrences) {
    if (!o.end) continue;
    const d = toDateOnly(o.start, tz);
    planned.set(d, (planned.get(d) ?? 0) + (o.end.getTime() - o.start.getTime()) / 60_000);
  }
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const d = toDateOnly(s.startedAt, tz); // 시작일 기준
    actual.set(d, (actual.get(d) ?? 0) + (s.endedAt.getTime() - s.startedAt.getTime()) / 60_000);
  }
  return days.map((date) => ({
    date,
    plannedMinutes: Math.round(planned.get(date) ?? 0),
    actualMinutes: Math.round(actual.get(date) ?? 0),
  }));
}

/** 과제 완료율 (이번 달) — 마감 전/후 완료 구분 (stage-7 §1-3) */
export function taskCompletionRate(
  tasks: ChronaEvent[],
  range: { from: Date; to: Date }
): { total: number; done: number; onTime: number; late: number } {
  let total = 0;
  let done = 0;
  let onTime = 0;
  let late = 0;
  for (const t of tasks) {
    if (t.kind !== 'task' || !t.dueAt) continue;
    if (t.dueAt < range.from || t.dueAt > range.to) continue;
    total++;
    if (t.isDone) {
      done++;
      if (t.doneAt && t.doneAt.getTime() <= t.dueAt.getTime()) onTime++;
      else late++;
    }
  }
  return { total, done, onTime, late };
}

/** 연속 집중 일수 (stage-7 §1-4). 하루 건너뛰면 리셋 */
export function focusStreak(
  sessions: FocusSession[],
  today: DateOnly,
  tz: string
): { current: number; best: number } {
  const days = new Set(sessions.map((s) => toDateOnly(s.startedAt, tz)));
  if (days.size === 0) return { current: 0, best: 0 };

  const sorted = [...days].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00Z`).getTime();
    const cur = new Date(`${sorted[i]}T00:00:00Z`).getTime();
    run = cur - prev === 86400_000 ? run + 1 : 1;
    if (run > best) best = run;
  }

  // current: 오늘(또는 어제)부터 뒤로 연속
  let current = 0;
  let cursor = today;
  if (!days.has(cursor)) {
    const y = new Date(`${cursor}T00:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    cursor = y.toISOString().slice(0, 10) as DateOnly;
  }
  while (days.has(cursor)) {
    current++;
    const d = new Date(`${cursor}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    cursor = d.toISOString().slice(0, 10) as DateOnly;
  }
  return { current, best };
}

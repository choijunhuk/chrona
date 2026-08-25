/**
 * 달력 격자 계산 — 순수 TS (Stage 2).
 * 주 시작: 월요일 (사용자 확정).
 *
 * 모든 입출력은 DateOnly('YYYY-MM-DD') — Date 객체는 내부 계산에만 쓰고
 * 로컬 컴포넌트(y/m/d)로만 만들어 시간대 영향이 없다 (master §7.2).
 */
import { addDays, format, startOfWeek } from 'date-fns';

import type { DateOnly } from './time';
import { asDateOnly } from './time';

export const WEEK_STARTS_ON = 1 as const; // 월요일

/** 요일 라벨 (월 시작) */
export const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'] as const;

function toLocalDate(d: DateOnly): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day, 12); // 정오 — DST 경계 안전
}

function fmt(d: Date): DateOnly {
  return format(d, 'yyyy-MM-dd') as DateOnly;
}

export type MonthGridCell = {
  date: DateOnly;
  inMonth: boolean; // 표시 중인 달에 속하는지
};

/** 해당 월의 6주 × 7일 격자 (항상 6주 — 드래그 전환 시 높이 고정용) */
export function monthGrid(year: number, month: number): MonthGridCell[][] {
  const first = new Date(year, month - 1, 1, 12);
  let cursor = startOfWeek(first, { weekStartsOn: WEEK_STARTS_ON });
  const weeks: MonthGridCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: MonthGridCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({ date: fmt(cursor), inMonth: cursor.getMonth() === month - 1 });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** date가 속한 주 (월요일 시작, 7일) */
export function weekOf(date: DateOnly): DateOnly[] {
  let cursor = startOfWeek(toLocalDate(date), { weekStartsOn: WEEK_STARTS_ON });
  const days: DateOnly[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(fmt(cursor));
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** monthGrid에서 date가 몇 번째 주(0~5)에 있는지. 없으면 -1 */
export function weekIndexOf(grid: MonthGridCell[][], date: DateOnly): number {
  return grid.findIndex((week) => week.some((c) => c.date === date));
}

export function addDaysOnly(date: DateOnly, days: number): DateOnly {
  return fmt(addDays(toLocalDate(date), days));
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function monthOf(date: DateOnly): { year: number; month: number } {
  const [y, m] = date.split('-').map(Number);
  return { year: y, month: m };
}

export function dayOfMonth(date: DateOnly): number {
  return Number(date.slice(8, 10));
}

/** '8월 24일 (월)' — 사람이 읽는 날짜 라벨 */
export function formatKoreanDate(date: DateOnly): string {
  const d = toLocalDate(date);
  const weekdayIdx = (d.getDay() + 6) % 7; // Mon=0
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_LABELS[weekdayIdx]})`;
}

export { asDateOnly };

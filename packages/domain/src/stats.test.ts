import { describe, expect, it } from 'vitest';

import { asDateOnly } from './time';
import type { Category, ChronaEvent, FocusSession } from './types';
import {
  focusStreak,
  plannedVsActual,
  taskCompletionRate,
  weeklyCategoryBreakdown,
} from './stats';

const TZ = 'Asia/Seoul';
const RANGE = {
  from: new Date('2026-08-23T15:00:00.000Z'), // 서울 8/24(월) 00:00
  to: new Date('2026-08-30T14:59:59.000Z'), // 서울 8/30(일) 23:59
};

const cats: Category[] = [
  { id: 'c1', name: '학교', color: '#6C7BFF', icon: null, sortOrder: 0 },
  { id: 'c2', name: '과제', color: '#D87B9E', icon: null, sortOrder: 1 },
];

describe('weeklyCategoryBreakdown (검증 1·3)', () => {
  it('카테고리별 duration 합산 — 수동 계산과 일치', () => {
    const occ = [
      { categoryId: 'c1', start: new Date('2026-08-24T00:00:00Z'), end: new Date('2026-08-24T01:15:00Z') }, // 75분
      { categoryId: 'c1', start: new Date('2026-08-26T00:00:00Z'), end: new Date('2026-08-26T01:15:00Z') }, // 75분
      { categoryId: 'c2', start: new Date('2026-08-25T05:00:00Z'), end: new Date('2026-08-25T06:00:00Z') }, // 60분
      { categoryId: null, start: new Date('2026-08-25T09:00:00Z'), end: new Date('2026-08-25T09:30:00Z') }, // 30분
    ];
    const slices = weeklyCategoryBreakdown(occ, cats, RANGE);
    expect(slices[0]).toMatchObject({ name: '학교', minutes: 150 });
    expect(slices[1]).toMatchObject({ name: '과제', minutes: 60 });
    expect(slices[2]).toMatchObject({ name: '미분류', minutes: 30 });
  });

  it('범위 밖·duration 없는 항목 제외 (휴강 회차는 전개 단계에서 이미 빠짐 — 검증 3)', () => {
    const occ = [
      { categoryId: 'c1', start: new Date('2026-09-05T00:00:00Z'), end: new Date('2026-09-05T01:00:00Z') },
      { categoryId: 'c1', start: new Date('2026-08-24T00:00:00Z'), end: null },
    ];
    expect(weeklyCategoryBreakdown(occ, cats, RANGE)).toHaveLength(0);
  });
});

describe('plannedVsActual (검증 4·7)', () => {
  const days = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'].map(asDateOnly);

  it('요일별 계획·실제 분리 집계', () => {
    const occ = [
      { categoryId: null, start: new Date('2026-08-24T00:00:00Z'), end: new Date('2026-08-24T02:00:00Z') }, // 월 120분 계획
    ];
    const sessions: FocusSession[] = [
      { id: 's1', eventId: null, startedAt: new Date('2026-08-24T01:00:00Z'), endedAt: new Date('2026-08-24T01:50:00Z'), plannedMinutes: 50, completed: true },
    ];
    const rows = plannedVsActual(occ, sessions, days, TZ);
    expect(rows[0]).toMatchObject({ date: '2026-08-24', plannedMinutes: 120, actualMinutes: 50 });
    expect(rows[1].actualMinutes).toBe(0);
  });

  it('자정 걸친 세션은 시작일 귀속', () => {
    const sessions: FocusSession[] = [
      {
        id: 's2',
        eventId: null,
        startedAt: new Date('2026-08-24T14:30:00Z'), // 서울 24일 23:30 시작
        endedAt: new Date('2026-08-24T15:30:00Z'), // 서울 25일 00:30 종료
        plannedMinutes: 60,
        completed: true,
      },
    ];
    const rows = plannedVsActual([], sessions, days, TZ);
    expect(rows[0].actualMinutes).toBe(60); // 24일에 전부
    expect(rows[1].actualMinutes).toBe(0);
  });
});

describe('taskCompletionRate', () => {
  const base = { kind: 'task', title: '', memo: null, categoryId: null, color: null, allDay: false, startsAt: null, endsAt: null, startDate: null, endDate: null, rrule: null, rruleUntil: null, isDone: false, doneAt: null, semesterId: null, location: null, professor: null, updatedAt: new Date() } as Omit<ChronaEvent, 'id' | 'dueAt'>;
  const t = (id: string, due: string, done: boolean, doneAt: string | null): ChronaEvent =>
    ({ ...base, id, dueAt: new Date(due), isDone: done, doneAt: doneAt ? new Date(doneAt) : null }) as ChronaEvent;

  it('마감 전/후 완료 구분', () => {
    const tasks = [
      t('1', '2026-08-25T15:00:00Z', true, '2026-08-24T00:00:00Z'), // onTime
      t('2', '2026-08-26T15:00:00Z', true, '2026-08-27T00:00:00Z'), // late
      t('3', '2026-08-27T15:00:00Z', false, null),
    ];
    expect(taskCompletionRate(tasks, RANGE)).toEqual({ total: 3, done: 2, onTime: 1, late: 1 });
  });
});

describe('focusStreak (검증 6)', () => {
  const s = (startISO: string): FocusSession => ({
    id: startISO, eventId: null, startedAt: new Date(startISO), endedAt: new Date(startISO), plannedMinutes: 25, completed: true,
  });

  it('연속 집계 + 하루 건너뛰면 리셋', () => {
    const sessions = [
      s('2026-08-20T01:00:00Z'), // 목
      s('2026-08-21T01:00:00Z'), // 금
      // 22 건너뜀
      s('2026-08-23T01:00:00Z'),
      s('2026-08-24T01:00:00Z'),
    ];
    const r = focusStreak(sessions, asDateOnly('2026-08-24'), TZ);
    expect(r.current).toBe(2); // 23~24
    expect(r.best).toBe(2);
  });

  it('오늘 아직 안 했으면 어제까지의 스트릭 유지', () => {
    const sessions = [s('2026-08-22T01:00:00Z'), s('2026-08-23T01:00:00Z')];
    const r = focusStreak(sessions, asDateOnly('2026-08-24'), TZ);
    expect(r.current).toBe(2);
  });

  it('빈 데이터', () => {
    expect(focusStreak([], asDateOnly('2026-08-24'), TZ)).toEqual({ current: 0, best: 0 });
  });
});

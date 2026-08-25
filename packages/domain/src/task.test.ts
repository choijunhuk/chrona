import { describe, expect, it } from 'vitest';

import { applicableTaskSteps, dDayLabel, daysUntilDue, dueUrgency } from './task';

const TZ = 'Asia/Seoul';

describe('daysUntilDue — 날짜 기준 (자정 경계 포함)', () => {
  it('같은 날 = 0 (시각 무관)', () => {
    const due = new Date('2026-08-24T14:59:00.000Z'); // 서울 24일 23:59
    const now = new Date('2026-08-23T15:10:00.000Z'); // 서울 24일 00:10
    expect(daysUntilDue(due, now, TZ)).toBe(0);
  });

  it('자정 경계: 23:50에 D-1 → 00:10에 D-0 (검증 9)', () => {
    const due = new Date('2026-08-24T14:59:00.000Z'); // 서울 24일 23:59
    const before = new Date('2026-08-23T14:50:00.000Z'); // 서울 23일 23:50
    const after = new Date('2026-08-23T15:10:00.000Z'); // 서울 24일 00:10
    expect(daysUntilDue(due, before, TZ)).toBe(1);
    expect(daysUntilDue(due, after, TZ)).toBe(0);
  });

  it('지난 마감 = 음수', () => {
    const due = new Date('2026-08-20T14:59:00.000Z');
    const now = new Date('2026-08-23T15:10:00.000Z'); // 서울 24일
    expect(daysUntilDue(due, now, TZ)).toBe(-4);
  });
});

describe('dueUrgency / dDayLabel', () => {
  it('urgency 매핑', () => {
    expect(dueUrgency(-1)).toBe('overdue');
    expect(dueUrgency(0)).toBe('today');
    expect(dueUrgency(3)).toBe('soon');
    expect(dueUrgency(4)).toBe('normal');
  });
  it('라벨', () => {
    expect(dDayLabel(0)).toBe('D-DAY');
    expect(dDayLabel(3)).toBe('D-3');
    expect(dDayLabel(-2)).toBe('D+2');
  });
});

describe('applicableTaskSteps — 지난 단계 스킵 (검증 3)', () => {
  const due = new Date('2026-08-25T14:59:00.000Z');

  it('마감 4일 전 생성 → 3단계 전부', () => {
    const now = new Date('2026-08-21T00:00:00.000Z');
    expect(applicableTaskSteps(due, now)).toHaveLength(3);
  });

  it('내일 마감 → 3일 전 스킵, 1일 전·3시간 전만', () => {
    const now = new Date('2026-08-24T20:00:00.000Z');
    const steps = applicableTaskSteps(due, now);
    expect(steps.map((s) => s.label)).toEqual(['3시간 전']);
  });

  it('2일 전 → 1일/3시간', () => {
    const now = new Date('2026-08-23T14:00:00.000Z');
    expect(applicableTaskSteps(due, now).map((s) => s.label)).toEqual(['1일 전', '3시간 전']);
  });

  it('마감 지남 → 0개', () => {
    const now = new Date('2026-08-26T00:00:00.000Z');
    expect(applicableTaskSteps(due, now)).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';

import { expandForDisplay } from './display';
import { asDateOnly, fromDateOnly, toDateOnly } from './time';
import type { ChronaEvent, EventOverride } from './types';

const TZ = 'Asia/Seoul';
const RANGE = {
  from: fromDateOnly(asDateOnly('2026-09-01'), TZ),
  to: fromDateOnly(asDateOnly('2026-09-30'), TZ),
};

function ev(partial: Partial<ChronaEvent>): ChronaEvent {
  return {
    id: 'e1',
    kind: 'schedule',
    title: '일정',
    memo: null,
    categoryId: null,
    color: null,
    allDay: false,
    startsAt: null,
    endsAt: null,
    startDate: null,
    endDate: null,
    rrule: null,
    rruleUntil: null,
    dueAt: null,
    isDone: false,
    doneAt: null,
    semesterId: null,
    location: null,
    professor: null,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...partial,
  };
}

function ov(partial: Partial<EventOverride>): EventOverride {
  return {
    id: 'o1',
    eventId: 'e1',
    originalStart: new Date('2026-09-07T01:00:00.000Z'),
    newStart: null,
    newEnd: null,
    isCancelled: false,
    ...partial,
  };
}

describe('expandForDisplay — 시각 일정', () => {
  it('비반복 일정은 그대로 1건', () => {
    const e = ev({
      startsAt: new Date('2026-09-08T01:00:00.000Z'), // 서울 10:00
      endsAt: new Date('2026-09-08T02:00:00.000Z'),
    });
    const out = expandForDisplay([e], [], RANGE, TZ);
    expect(out).toHaveLength(1);
    expect(out[0].start?.toISOString()).toBe('2026-09-08T01:00:00.000Z');
    expect(out[0].startDate).toBeNull();
  });

  it('범위 밖 일정은 제외', () => {
    const e = ev({ startsAt: new Date('2026-10-08T01:00:00.000Z'), endsAt: null });
    expect(expandForDisplay([e], [], RANGE, TZ)).toHaveLength(0);
  });

  it('반복 전개 후 override의 새 시각으로 교체, 길이 유지', () => {
    const e = ev({
      startsAt: new Date('2026-09-07T01:00:00.000Z'), // 서울 월 10:00
      endsAt: new Date('2026-09-07T02:00:00.000Z'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const moved = ov({
      originalStart: new Date('2026-09-14T01:00:00.000Z'),
      newStart: new Date('2026-09-14T04:00:00.000Z'), // 서울 13:00으로 이동
    });
    const out = expandForDisplay([e], [moved], RANGE, TZ);
    const starts = out.map((i) => i.start!.toISOString());
    expect(starts).toContain('2026-09-14T04:00:00.000Z');
    expect(starts).not.toContain('2026-09-14T01:00:00.000Z');
    const movedItem = out.find((i) => i.start!.toISOString() === '2026-09-14T04:00:00.000Z')!;
    expect(movedItem.end!.getTime() - movedItem.start!.getTime()).toBe(3600_000);
  });

  it('휴강(is_cancelled) 회차는 사라진다', () => {
    const e = ev({
      startsAt: new Date('2026-09-07T01:00:00.000Z'),
      endsAt: new Date('2026-09-07T02:00:00.000Z'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const cancelled = ov({
      originalStart: new Date('2026-09-14T01:00:00.000Z'),
      isCancelled: true,
    });
    const before = expandForDisplay([e], [], RANGE, TZ).length;
    const after = expandForDisplay([e], [cancelled], RANGE, TZ);
    expect(after).toHaveLength(before - 1);
    expect(after.map((i) => i.start!.toISOString())).not.toContain('2026-09-14T01:00:00.000Z');
  });
});

describe('expandForDisplay — 종일 일정', () => {
  it('비반복 종일은 date 범위를 유지한다 (§7.2)', () => {
    const e = ev({
      allDay: true,
      startDate: asDateOnly('2026-09-10'),
      endDate: asDateOnly('2026-09-12'),
    });
    const out = expandForDisplay([e], [], RANGE, TZ);
    expect(out).toHaveLength(1);
    expect(out[0].start).toBeNull();
    expect(out[0].startDate).toBe('2026-09-10');
    expect(out[0].endDate).toBe('2026-09-12');
  });

  it('종일 반복은 date 기준으로 전개되고 기간(span)을 유지한다', () => {
    const e = ev({
      allDay: true,
      startDate: asDateOnly('2026-09-07'),
      endDate: asDateOnly('2026-09-08'), // 2일짜리
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const out = expandForDisplay([e], [], RANGE, TZ);
    expect(out.map((i) => i.startDate)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    expect(out.every((i) => i.start === null)).toBe(true);
    expect(out[0].endDate).toBe('2026-09-08');
  });

  it('종일 반복 회차 휴강은 제외된다', () => {
    const e = ev({
      allDay: true,
      startDate: asDateOnly('2026-09-07'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const cancelled = ov({
      originalStart: fromDateOnly(asDateOnly('2026-09-14'), TZ),
      isCancelled: true,
    });
    const out = expandForDisplay([e], [cancelled], RANGE, TZ);
    expect(out.map((i) => i.startDate)).toEqual(['2026-09-07', '2026-09-21', '2026-09-28']);
  });

  it('★ 종일 반복 회차의 시각 이동 override도 날짜에 반영된다', () => {
    const e = ev({
      allDay: true,
      startDate: asDateOnly('2026-09-07'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const moved = ov({
      originalStart: fromDateOnly(asDateOnly('2026-09-14'), TZ),
      newStart: fromDateOnly(asDateOnly('2026-09-16'), TZ), // 수요일로 이동
    });
    const out = expandForDisplay([e], [moved], RANGE, TZ);
    expect(out.map((i) => i.startDate)).toContain('2026-09-16');
    expect(out.map((i) => i.startDate)).not.toContain('2026-09-14');
    const movedItem = out.find((i) => i.startDate === '2026-09-16')!;
    expect(movedItem.endDate).toBe('2026-09-16');
  });
});

describe('expandForDisplay — 과제', () => {
  it('범위 안 마감만 포함하고 dueAt을 start로 쓴다', () => {
    const inRange = ev({ id: 't1', kind: 'task', dueAt: new Date('2026-09-09T14:00:00.000Z') });
    const outRange = ev({ id: 't2', kind: 'task', dueAt: new Date('2026-10-09T14:00:00.000Z') });
    const noDue = ev({ id: 't3', kind: 'task', dueAt: null });
    const out = expandForDisplay([inRange, outRange, noDue], [], RANGE, TZ);
    expect(out).toHaveLength(1);
    expect(out[0].event.id).toBe('t1');
    expect(toDateOnly(out[0].start!, TZ)).toBe('2026-09-09');
  });
});

describe('expandForDisplay — 정렬', () => {
  it('종일·시각이 섞여도 시작 시각 오름차순', () => {
    const late = ev({ id: 'a', startsAt: new Date('2026-09-20T01:00:00.000Z'), endsAt: null });
    const early = ev({ id: 'b', allDay: true, startDate: asDateOnly('2026-09-05') });
    const out = expandForDisplay([late, early], [], RANGE, TZ);
    expect(out.map((i) => i.event.id)).toEqual(['b', 'a']);
  });
});

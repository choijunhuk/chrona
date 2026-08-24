import { describe, expect, it } from 'vitest';

import { applyOverrides, expandRule } from './recurrence';
import type { Occurrence } from './schedule';
import type { EventOverride } from './types';

const TZ = 'Asia/Seoul';
// 2026-09-01(화) 09:00 KST = 00:00Z
const DTSTART = new Date('2026-09-01T00:00:00.000Z');
const RANGE = {
  from: new Date('2026-08-31T00:00:00.000Z'),
  to: new Date('2026-10-10T00:00:00.000Z'),
};

describe('expandRule', () => {
  it('매주 화요일 5회 — 벽시계 09:00 유지', () => {
    const dates = expandRule('FREQ=WEEKLY;BYDAY=TU;COUNT=5', DTSTART, null, RANGE, TZ);
    expect(dates).toHaveLength(5);
    expect(dates[0].toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(dates[4].toISOString()).toBe('2026-09-29T00:00:00.000Z');
    // 전부 KST 09:00
    for (const d of dates) {
      expect(
        new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d)
      ).toBe('09');
    }
  });

  it('until로 잘림', () => {
    const until = new Date('2026-09-15T00:00:00.000Z'); // 3회차 직후
    const dates = expandRule('FREQ=WEEKLY;BYDAY=TU', DTSTART, until, RANGE, TZ);
    expect(dates).toHaveLength(3);
  });

  it('until 없어도 range.to로 유한', () => {
    const dates = expandRule('FREQ=DAILY', DTSTART, null, RANGE, TZ);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.length).toBeLessThan(60);
    expect(dates.at(-1)!.getTime()).toBeLessThanOrEqual(RANGE.to.getTime());
  });

  it('DST 시간대(뉴욕)에서도 벽시계 유지', () => {
    // 뉴욕 2026-10-30(금) 09:00 EDT → 매주 금. 11-01 DST 종료 이후 EST에서도 09:00 유지
    const nyStart = new Date('2026-10-30T13:00:00.000Z'); // 09:00 EDT
    const dates = expandRule(
      'FREQ=WEEKLY;BYDAY=FR;COUNT=3',
      nyStart,
      null,
      { from: new Date('2026-10-29T00:00:00Z'), to: new Date('2026-11-20T00:00:00Z') },
      'America/New_York'
    );
    for (const d of dates) {
      const hour = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        hour12: false,
      }).format(d);
      expect(hour).toBe('09');
    }
    // DST 경계를 넘으며 UTC 시각은 13:00Z → 14:00Z로 이동
    expect(dates[0].toISOString()).toBe('2026-10-30T13:00:00.000Z');
    expect(dates[2].toISOString()).toBe('2026-11-13T14:00:00.000Z');
  });
});

describe('applyOverrides — 스펙 5개 시나리오 (stage-5 §1-2)', () => {
  const mk = (starts: Date[]): Occurrence[] =>
    starts.map((start) => ({
      eventId: 'e1',
      title: '자료구조',
      colorHex: null,
      start,
      end: new Date(start.getTime() + 75 * 60_000),
    }));

  const five = mk(expandRule('FREQ=WEEKLY;BYDAY=TU;COUNT=5', DTSTART, null, RANGE, TZ));
  const ov = (partial: Partial<EventOverride>): EventOverride => ({
    id: 'o1',
    eventId: 'e1',
    originalStart: five[2].start,
    newStart: null,
    newEnd: null,
    isCancelled: false,
    ...partial,
  });

  it('기본 5회', () => {
    expect(five).toHaveLength(5);
  });

  it('3번째 회차 취소 → 4개 (휴강 시나리오 — 검증 5)', () => {
    const result = applyOverrides(five, [ov({ isCancelled: true })], RANGE);
    expect(result).toHaveLength(4);
    expect(result.map((o) => o.start.getTime())).not.toContain(five[2].start.getTime());
  });

  it('2번째 회차를 수요일로 이동 → 재정렬', () => {
    const wed = new Date(five[1].start.getTime() + 86400_000);
    const result = applyOverrides(
      five,
      [ov({ originalStart: five[1].start, newStart: wed })],
      RANGE
    );
    expect(result).toHaveLength(5);
    // 정렬 유지 확인
    for (let i = 1; i < result.length; i++) {
      expect(result[i].start.getTime()).toBeGreaterThan(result[i - 1].start.getTime());
    }
    expect(result.some((o) => o.start.getTime() === wed.getTime())).toBe(true);
    // duration 유지 (75분)
    const moved = result.find((o) => o.start.getTime() === wed.getTime())!;
    expect(moved.end!.getTime() - moved.start.getTime()).toBe(75 * 60_000);
  });

  it('마지막 회차를 range 밖으로 이동 → 제외', () => {
    const outside = new Date(RANGE.to.getTime() + 86400_000);
    const result = applyOverrides(
      five,
      [ov({ originalStart: five[4].start, newStart: outside })],
      RANGE
    );
    expect(result).toHaveLength(4);
  });

  it('range 밖 회차를 안으로 이동 → 포함', () => {
    // 6번째 회차(10/6, range 안이지만 COUNT=5라 전개엔 없음)를 range 안 시각으로 온 것처럼:
    // 여기선 "range 밖 original"을 흉내 — original은 전개에 없는 시각
    const originalOutside = new Date('2026-10-20T00:00:00.000Z'); // 전개에 없음
    const movedIn = new Date('2026-10-05T00:00:00.000Z'); // range 안
    const result = applyOverrides(
      five,
      [ov({ originalStart: originalOutside, newStart: movedIn })],
      RANGE
    );
    expect(result).toHaveLength(6);
    expect(result.at(-1)!.start.getTime()).toBe(movedIn.getTime());
    expect(result.at(-1)!.title).toBe('자료구조'); // 템플릿 복제
  });
});

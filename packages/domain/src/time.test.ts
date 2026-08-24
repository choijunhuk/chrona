import { describe, expect, it } from 'vitest';

import {
  asDateOnly,
  formatTimeLabel,
  fromDateOnly,
  isDateOnly,
  normalizeTimeOfDay,
  resolveTimezone,
  toDateOnly,
} from './time';

// master §7.2 핵심 검증: 종일 일정은 어느 시간대에서도 하루가 밀리지 않는다
const ZONES = ['Asia/Seoul', 'UTC', 'America/New_York'];

describe('DateOnly 왕복 — 3개 시간대 하루 밀림 검증', () => {
  it.each(ZONES)('%s: fromDateOnly → toDateOnly 왕복이 동일하다', (tz) => {
    const day = asDateOnly('2026-08-24');
    const midnight = fromDateOnly(day, tz);
    expect(toDateOnly(midnight, tz)).toBe('2026-08-24');
  });

  it.each(ZONES)('%s: 월말·연말 경계에서도 밀리지 않는다', (tz) => {
    for (const s of ['2026-01-01', '2026-02-28', '2026-12-31', '2028-02-29']) {
      const day = asDateOnly(s);
      expect(toDateOnly(fromDateOnly(day, tz), tz)).toBe(s);
    }
  });

  it('같은 순간이라도 시간대에 따라 날짜는 다르게 읽힌다 (timestamp로 종일을 저장하면 안 되는 이유)', () => {
    // 서울 2026-08-24 00:30 = UTC 2026-08-23 15:30 = 뉴욕 2026-08-23 11:30
    const instant = new Date('2026-08-23T15:30:00Z');
    expect(toDateOnly(instant, 'Asia/Seoul')).toBe('2026-08-24');
    expect(toDateOnly(instant, 'UTC')).toBe('2026-08-23');
    expect(toDateOnly(instant, 'America/New_York')).toBe('2026-08-23');
  });

  it('fromDateOnly는 해당 시간대의 00:00을 가리킨다', () => {
    const day = asDateOnly('2026-08-24');
    expect(fromDateOnly(day, 'Asia/Seoul').toISOString()).toBe('2026-08-23T15:00:00.000Z');
    expect(fromDateOnly(day, 'UTC').toISOString()).toBe('2026-08-24T00:00:00.000Z');
    // 뉴욕 8월 = EDT(UTC-4)
    expect(fromDateOnly(day, 'America/New_York').toISOString()).toBe('2026-08-24T04:00:00.000Z');
  });

  it('DST 전환일에도 왕복이 유지된다 (뉴욕 2026-03-08 spring forward)', () => {
    const day = asDateOnly('2026-03-08');
    expect(toDateOnly(fromDateOnly(day, 'America/New_York'), 'America/New_York')).toBe(
      '2026-03-08'
    );
  });
});

describe('formatTimeLabel', () => {
  const instant = new Date('2026-08-23T15:30:00Z');

  it('시간대별 표시', () => {
    expect(formatTimeLabel(instant, 'Asia/Seoul')).toBe('오전 12:30'); // 자정 넘음
    expect(formatTimeLabel(instant, 'UTC')).toBe('오후 3:30');
    expect(formatTimeLabel(instant, 'America/New_York')).toBe('오전 11:30');
  });

  it('정오/자정 경계', () => {
    expect(formatTimeLabel(new Date('2026-08-23T12:00:00Z'), 'UTC')).toBe('오후 12:00');
    expect(formatTimeLabel(new Date('2026-08-23T00:00:00Z'), 'UTC')).toBe('오전 12:00');
  });
});

describe('입력 검증', () => {
  it('isDateOnly / asDateOnly', () => {
    expect(isDateOnly('2026-08-24')).toBe(true);
    expect(isDateOnly('2026-8-24')).toBe(false);
    expect(isDateOnly('2026-08-24T00:00:00Z')).toBe(false);
    expect(() => asDateOnly('not-a-date')).toThrow();
  });

  it('normalizeTimeOfDay', () => {
    expect(normalizeTimeOfDay('09:00:00')).toBe('09:00');
    expect(normalizeTimeOfDay('23:00')).toBe('23:00');
  });

  it('resolveTimezone: fixedTimezone 우선', () => {
    expect(resolveTimezone({ fixedTimezone: 'Asia/Seoul' })).toBe('Asia/Seoul');
    expect(typeof resolveTimezone(null)).toBe('string'); // 기기 시간대
    expect(resolveTimezone({ fixedTimezone: null }).length).toBeGreaterThan(0);
  });
});

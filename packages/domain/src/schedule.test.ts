import { describe, expect, it } from 'vitest';

import { asDateOnly } from './time';
import type { ChronaEvent, EventOverride, Reminder, StandaloneAlarm } from './types';
import {
  ALARM_LIMIT,
  computeAlarmTimes,
  expandOccurrences,
  expandStandaloneAlarms,
} from './schedule';

const TZ = 'Asia/Seoul';
const NOW = new Date('2026-08-24T03:00:00.000Z'); // 서울 12:00
const RANGE = { from: NOW, to: new Date(NOW.getTime() + 60 * 86400_000) };
const SETTINGS = { snoozeMinutes: 5, maxSnoozeCount: 3, defaultSoundKey: 'default', tz: TZ };

function ev(partial: Partial<ChronaEvent>): ChronaEvent {
  return {
    id: 'e1',
    kind: 'schedule',
    title: '수업',
    memo: null,
    categoryId: null,
    color: null,
    allDay: false,
    startsAt: new Date('2026-08-25T01:00:00.000Z'), // 서울 10:00
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
    updatedAt: NOW,
    ...partial,
  };
}

function rem(partial: Partial<Reminder>): Reminder {
  return {
    id: 'r1',
    eventId: 'e1',
    offsetMinutes: 10,
    mode: 'notify',
    soundKey: 'default',
    vibrate: true,
    enabled: true,
    ...partial,
  };
}

describe('expandOccurrences', () => {
  it('단일 일정 pass-through', () => {
    const occ = expandOccurrences([ev({})], RANGE, [], TZ);
    expect(occ).toHaveLength(1);
    expect(occ[0].start.toISOString()).toBe('2026-08-25T01:00:00.000Z');
  });

  it('범위 밖 제외', () => {
    const past = ev({ startsAt: new Date('2026-08-20T01:00:00.000Z') });
    expect(expandOccurrences([past], RANGE, [], TZ)).toHaveLength(0);
  });

  it('override 취소 회차 제외', () => {
    const o: EventOverride = {
      id: 'o1',
      eventId: 'e1',
      originalStart: new Date('2026-08-25T01:00:00.000Z'),
      newStart: null,
      newEnd: null,
      isCancelled: true,
    };
    expect(expandOccurrences([ev({})], RANGE, [o], TZ)).toHaveLength(0);
  });

  it('override 시각 변경 반영', () => {
    const o: EventOverride = {
      id: 'o1',
      eventId: 'e1',
      originalStart: new Date('2026-08-25T01:00:00.000Z'),
      newStart: new Date('2026-08-25T05:00:00.000Z'),
      newEnd: null,
      isCancelled: false,
    };
    const occ = expandOccurrences([ev({})], RANGE, [o], TZ);
    expect(occ[0].start.toISOString()).toBe('2026-08-25T05:00:00.000Z');
  });

  it('종일 일정 → 해당 날 09:00 로컬 기준', () => {
    const allDay = ev({
      allDay: true,
      startsAt: null,
      startDate: asDateOnly('2026-08-26'),
    });
    const occ = expandOccurrences([allDay], RANGE, [], TZ);
    // 서울 2026-08-26 09:00 = UTC 26일 00:00
    expect(occ[0].start.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });

  it('task는 due_at 기준, 완료된 task 제외', () => {
    const due = new Date('2026-08-27T14:59:00.000Z');
    const task = ev({ kind: 'task', startsAt: null, dueAt: due });
    expect(expandOccurrences([task], RANGE, [], TZ)[0].start.toISOString()).toBe(due.toISOString());
    expect(expandOccurrences([ev({ kind: 'task', startsAt: null, dueAt: due, isDone: true })], RANGE, [], TZ)).toHaveLength(0);
  });
});

describe('computeAlarmTimes', () => {
  const occ = expandOccurrences([ev({})], RANGE, [], TZ);

  it('offset 적용 + payload 구성', () => {
    const planned = computeAlarmTimes(occ, [rem({})], [], NOW, ALARM_LIMIT, SETTINGS);
    expect(planned).toHaveLength(1);
    expect(planned[0].fireAt.toISOString()).toBe('2026-08-25T00:50:00.000Z'); // 10분 전
    expect(planned[0].payload.timeLabel).toBe('오전 10:00'); // 일정 시각 기준 라벨
    expect(planned[0].mode).toBe('notify');
  });

  it('과거 발화 시각 제외', () => {
    const soon = expandOccurrences(
      [ev({ startsAt: new Date(NOW.getTime() + 5 * 60_000) })], // 5분 뒤 시작
      RANGE,
      [],
      TZ
    );
    // 10분 전 = 과거 → 제외
    expect(computeAlarmTimes(soon, [rem({})], [], NOW, ALARM_LIMIT, SETTINGS)).toHaveLength(0);
  });

  it('enabled=false reminder 제외', () => {
    expect(
      computeAlarmTimes(occ, [rem({ enabled: false })], [], NOW, ALARM_LIMIT, SETTINGS)
    ).toHaveLength(0);
  });

  it('오름차순 정렬 + 30건 제한', () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      ev({ id: `e${i}`, startsAt: new Date(NOW.getTime() + (40 - i) * 3600_000) })
    );
    const occs = expandOccurrences(events, RANGE, [], TZ);
    const rems = events.map((e) => rem({ id: `r${e.id}`, eventId: e.id }));
    const planned = computeAlarmTimes(occs, rems, [], NOW, ALARM_LIMIT, SETTINGS);
    expect(planned).toHaveLength(ALARM_LIMIT);
    for (let i = 1; i < planned.length; i++) {
      expect(planned[i].fireAt.getTime()).toBeGreaterThanOrEqual(planned[i - 1].fireAt.getTime());
    }
    // 가장 가까운 30건 = 처음 발화가 최소값
    expect(planned[0].fireAt.getTime()).toBeLessThan(planned[29].fireAt.getTime());
  });

  it('순수 알람 합류 — 30건 상한 공유', () => {
    const alarm: StandaloneAlarm = {
      id: 'a1',
      time: '07:00',
      weekdays: [],
      label: '기상',
      enabled: true,
      soundKey: 'default',
      vibrate: true,
    };
    const standalone = expandStandaloneAlarms([alarm], NOW, RANGE.to, TZ);
    const planned = computeAlarmTimes([], [], standalone, NOW, ALARM_LIMIT, SETTINGS);
    expect(planned).toHaveLength(1); // 1회성 → 다음 07:00 한 번
    expect(planned[0].mode).toBe('alarm');
    expect(planned[0].payload.title).toBe('기상');
    expect(planned[0].payload.eventId).toBe('standalone:a1');
  });
});

describe('expandStandaloneAlarms', () => {
  it('요일 반복: 지정 요일만', () => {
    const weekdayAlarm: StandaloneAlarm = {
      id: 'a2',
      time: '07:00',
      weekdays: [1, 2, 3, 4, 5], // 월~금
      label: '평일',
      enabled: true,
      soundKey: 'default',
      vibrate: true,
    };
    const fires = expandStandaloneAlarms([weekdayAlarm], NOW, new Date(NOW.getTime() + 14 * 86400_000), TZ);
    expect(fires.length).toBe(10); // 2주간 평일 10회
    for (const f of fires) {
      const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(f.fireAt);
      expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(wd);
    }
  });

  it('disabled 알람 무시, 1회성은 첫 발화만', () => {
    const off: StandaloneAlarm = {
      id: 'a3', time: '07:00', weekdays: [], label: null, enabled: false, soundKey: 'default', vibrate: true,
    };
    expect(expandStandaloneAlarms([off], NOW, RANGE.to, TZ)).toHaveLength(0);
    const oneShot: StandaloneAlarm = { ...off, id: 'a4', enabled: true };
    expect(expandStandaloneAlarms([oneShot], NOW, RANGE.to, TZ)).toHaveLength(1);
  });
});

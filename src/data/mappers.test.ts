import { describe, expect, it } from 'vitest';

import { asDateOnly } from '@/domain/time';

import type { EventDraft, EventRow, StandaloneAlarmRow } from './mappers';
import {
  toDomainEvent,
  toDomainSettings,
  toDomainStandaloneAlarm,
  toEventInsert,
  toSettingsUpdate,
  toStandaloneAlarmInsert,
  toStandaloneAlarmUpdate,
} from './mappers';

const baseRow: EventRow = {
  id: 'e1',
  user_id: 'u1',
  kind: 'schedule',
  title: '수업',
  memo: null,
  category_id: 'c1',
  color: null,
  starts_at: '2026-08-24T01:00:00.000Z',
  ends_at: '2026-08-24T02:15:00.000Z',
  all_day: false,
  start_date: null,
  end_date: null,
  rrule: null,
  rrule_until: null,
  due_at: null,
  is_done: false,
  done_at: null,
  semester_id: null,
  location: null,
  professor: null,
  updated_at: '2026-08-23T00:00:00.000Z',
  deleted_at: null,
};

const baseDraft: EventDraft = {
  kind: 'schedule',
  title: '수업',
  memo: null,
  categoryId: 'c1',
  color: null,
  allDay: false,
  startsAt: new Date('2026-08-24T01:00:00.000Z'),
  endsAt: new Date('2026-08-24T02:15:00.000Z'),
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
};

describe('toDomainEvent', () => {
  it('시각 일정: timestamptz → Date, date 필드는 null', () => {
    const e = toDomainEvent(baseRow);
    expect(e.startsAt?.toISOString()).toBe('2026-08-24T01:00:00.000Z');
    expect(e.startDate).toBeNull();
    expect(e.allDay).toBe(false);
  });

  it('종일 일정: date → DateOnly 문자열 그대로, Date 객체 생성 안 함 (§7.2)', () => {
    const e = toDomainEvent({
      ...baseRow,
      all_day: true,
      starts_at: null,
      ends_at: null,
      start_date: '2026-08-24',
      end_date: '2026-08-24',
    });
    expect(e.startDate).toBe('2026-08-24'); // 문자열 유지 — 시간대 무관
    expect(e.startsAt).toBeNull();
    expect(e.endsAt).toBeNull();
  });

  it('종일인데 timestamp가 실려 있으면 무시한다 (방어)', () => {
    const e = toDomainEvent({
      ...baseRow,
      all_day: true,
      start_date: '2026-08-24',
      starts_at: '2026-08-24T01:00:00.000Z', // 오염 데이터
    });
    expect(e.startsAt).toBeNull();
  });

  it('task 필드 매핑', () => {
    const e = toDomainEvent({
      ...baseRow,
      kind: 'task',
      due_at: '2026-08-27T15:00:00.000Z',
      is_done: true,
      done_at: '2026-08-25T10:00:00.000Z',
    });
    expect(e.kind).toBe('task');
    expect(e.dueAt?.toISOString()).toBe('2026-08-27T15:00:00.000Z');
    expect(e.isDone).toBe(true);
  });
});

describe('toEventInsert', () => {
  it('시각 일정 왕복: draft → insert → row → domain 동일성', () => {
    const insert = toEventInsert(baseDraft, 'u1');
    expect(insert.starts_at).toBe('2026-08-24T01:00:00.000Z');
    expect(insert.start_date).toBeNull();
    expect(insert.user_id).toBe('u1');
    expect(insert.updated_at).toBeTruthy(); // §7.3 명시적 updated_at

    const roundTrip = toDomainEvent({
      ...baseRow,
      ...insert,
      id: 'e2',
      updated_at: insert.updated_at!,
    } as EventRow);
    expect(roundTrip.title).toBe(baseDraft.title);
    expect(roundTrip.startsAt?.getTime()).toBe(baseDraft.startsAt?.getTime());
  });

  it('종일 일정: date만 실린다', () => {
    const insert = toEventInsert(
      {
        ...baseDraft,
        allDay: true,
        startsAt: null,
        endsAt: null,
        startDate: asDateOnly('2026-08-24'),
        endDate: asDateOnly('2026-08-25'),
      },
      'u1'
    );
    expect(insert.all_day).toBe(true);
    expect(insert.start_date).toBe('2026-08-24');
    expect(insert.starts_at).toBeNull();
  });

  it('§7.2 위반 시 throw: 종일 + timestamp', () => {
    expect(() =>
      toEventInsert(
        { ...baseDraft, allDay: true, startDate: asDateOnly('2026-08-24') },
        'u1'
      )
    ).toThrow(/timestamps/);
  });

  it('§7.2 위반 시 throw: 시각 일정 + date 필드', () => {
    expect(() =>
      toEventInsert({ ...baseDraft, startDate: asDateOnly('2026-08-24') }, 'u1')
    ).toThrow(/date-only/);
  });

  it('§7.2 위반 시 throw: 종일인데 startDate 없음', () => {
    expect(() =>
      toEventInsert({ ...baseDraft, allDay: true, startsAt: null, endsAt: null }, 'u1')
    ).toThrow(/startDate/);
  });
});

describe('settings 매핑', () => {
  it('toDomainSettings: time 컬럼 HH:MM 정규화', () => {
    const s = toDomainSettings({
      user_id: 'u1',
      ongoing_enabled: false,
      briefing_enabled: true,
      briefing_time: '23:00:00',
      default_reminder_offset: 10,
      snooze_minutes: 5,
      max_snooze_count: 3,
      default_sound_key: 'default',
      fixed_timezone: null,
      theme: 'dark',
      permission_checked_at: null,
      updated_at: '2026-08-23T00:00:00.000Z',
    });
    expect(s.briefingTime).toBe('23:00');
    expect(s.fixedTimezone).toBeNull();
  });

  it('toSettingsUpdate: 전달한 필드만 + updated_at 항상 포함', () => {
    const u = toSettingsUpdate({ snoozeMinutes: 10 });
    expect(u.snooze_minutes).toBe(10);
    expect(u.updated_at).toBeTruthy();
    expect(u.briefing_enabled).toBeUndefined();
  });
});

describe('standalone_alarms 매핑 (stage-15 challenge)', () => {
  const alarmRow: StandaloneAlarmRow = {
    id: 'a1',
    user_id: 'u1',
    time: '07:00:00',
    weekdays: [1, 2, 3, 4, 5],
    label: '기상',
    enabled: true,
    sound_key: 'default',
    vibrate: true,
    challenge: 'shake',
    updated_at: '2026-09-01T00:00:00.000Z',
    deleted_at: null,
  };

  it('time HH:MM 정규화 + challenge 그대로', () => {
    const a = toDomainStandaloneAlarm(alarmRow);
    expect(a.time).toBe('07:00');
    expect(a.challenge).toBe('shake');
  });

  it('challenge가 없는 옛 행(0007 이전 백업)은 none으로 (기존 동작 유지)', () => {
    const legacy = { ...alarmRow } as Partial<StandaloneAlarmRow>;
    delete legacy.challenge;
    expect(toDomainStandaloneAlarm(legacy as StandaloneAlarmRow).challenge).toBe('none');
  });

  it('toStandaloneAlarmInsert: challenge 포함 + updated_at 명시 (§7.3)', () => {
    const insert = toStandaloneAlarmInsert(
      {
        time: '07:00',
        weekdays: [],
        label: null,
        enabled: true,
        soundKey: 'default',
        vibrate: true,
        challenge: 'math',
      },
      'u1'
    );
    expect(insert.challenge).toBe('math');
    expect(insert.user_id).toBe('u1');
    expect(insert.updated_at).toBeTruthy();
  });

  it('toStandaloneAlarmUpdate: 전달한 필드만 + updated_at 항상 포함', () => {
    const u = toStandaloneAlarmUpdate({ challenge: 'none', vibrate: false });
    expect(u.challenge).toBe('none');
    expect(u.vibrate).toBe(false);
    expect(u.time).toBeUndefined();
    expect(u.updated_at).toBeTruthy();
  });
});

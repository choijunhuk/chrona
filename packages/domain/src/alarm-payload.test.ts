/**
 * AlarmPayload 직렬화 계약 (master §3.5).
 * 앱이 죽은 상태에서 알람이 뜰 때 화면을 채우는 유일한 데이터원이라, 손상된 payload에서도
 * "어떻게든 뜨는" 기본값이 나와야 한다. 여기서 깨지면 알람이 빈 화면으로 뜬다.
 */
import { describe, expect, it } from 'vitest';

import { parseAlarmPayload, serializeAlarmPayload, type AlarmPayload } from './alarm-payload';

const PAYLOAD: AlarmPayload = {
  eventId: 'e1',
  occurrenceStart: '2026-08-25T01:00:00.000Z',
  title: '자료구조',
  timeLabel: '오전 10:00',
  colorHex: '#FF8A3D',
  snoozeMinutes: 5,
  maxSnooze: 3,
  currentSnoozeCount: 1,
  soundKey: 'alarm_02',
  challenge: 'none',
};

describe('serializeAlarmPayload / parseAlarmPayload', () => {
  it('직렬화 → 파싱 라운드트립이 원본과 같다', () => {
    expect(parseAlarmPayload(serializeAlarmPayload(PAYLOAD))).toEqual(PAYLOAD);
  });

  it('직렬화 결과는 전부 문자열이다 (Notifee data는 문자열만 허용)', () => {
    const serialized = serializeAlarmPayload(PAYLOAD);
    for (const v of Object.values(serialized)) {
      expect(typeof v).toBe('string');
    }
    expect(serialized.snoozeMinutes).toBe('5');
    expect(serialized.currentSnoozeCount).toBe('1');
  });

  it('필드가 전부 없으면 안전한 기본값 (스누즈 5분·3회·기본음)', () => {
    expect(parseAlarmPayload(undefined)).toEqual({
      eventId: '',
      occurrenceStart: '',
      title: '알람',
      timeLabel: '',
      colorHex: '#6C7BFF',
      snoozeMinutes: 5,
      maxSnooze: 3,
      currentSnoozeCount: 0,
      soundKey: 'default', challenge: 'none',
    });
  });

  it('빈 문자열 필드는 기본값으로 대체된다', () => {
    const p = parseAlarmPayload({ ...serializeAlarmPayload(PAYLOAD), title: '', colorHex: '' });
    expect(p.title).toBe('알람');
    expect(p.colorHex).toBe('#6C7BFF');
  });

  it('숫자가 아닌 값은 기본값으로 떨어진다', () => {
    const p = parseAlarmPayload({
      ...serializeAlarmPayload(PAYLOAD),
      snoozeMinutes: 'abc',
      maxSnooze: 'three',
      currentSnoozeCount: undefined,
    });
    expect(p.snoozeMinutes).toBe(5);
    expect(p.maxSnooze).toBe(3);
    expect(p.currentSnoozeCount).toBe(0);
  });

  it('null·빈 문자열은 기본값 (0이 아님)', () => {
    expect(parseAlarmPayload({ maxSnooze: null }).maxSnooze).toBe(3);
    expect(parseAlarmPayload({ snoozeMinutes: '' }).snoozeMinutes).toBe(5);
  });

  it('숫자 문자열이 아닌 실제 숫자가 와도 파싱된다 (라우트 파라미터 혼용 대비)', () => {
    const p = parseAlarmPayload({ ...serializeAlarmPayload(PAYLOAD), currentSnoozeCount: 2 });
    expect(p.currentSnoozeCount).toBe(2);
  });
});

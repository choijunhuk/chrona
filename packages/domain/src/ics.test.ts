import { describe, expect, it } from 'vitest';

import { parseIcs } from './ics';

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:1@test',
  'SUMMARY:중간고사',
  'DTSTART;VALUE=DATE:20261019',
  'DTEND;VALUE=DATE:20261024',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:2@test',
  'SUMMARY:팀 미팅',
  'DESCRIPTION:아젠다\\n1. 진행상황\\, 검토',
  'LOCATION:새빛관 401',
  'DTSTART:20261005T060000Z',
  'DTEND:20261005T070000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T000000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcs', () => {
  it('종일 이벤트: VALUE=DATE → time null', () => {
    const [allDay] = parseIcs(SAMPLE);
    expect(allDay.title).toBe('중간고사');
    expect(allDay.start).toEqual({ date: '2026-10-19', time: null, utc: false });
    expect(allDay.end).toEqual({ date: '2026-10-24', time: null, utc: false });
    expect(allDay.rrule).toBeNull();
  });

  it('시각 이벤트: UTC 시각 + 텍스트 이스케이프 해제', () => {
    const [, timed] = parseIcs(SAMPLE);
    expect(timed.start).toEqual({ date: '2026-10-05', time: '06:00:00', utc: true });
    expect(timed.memo).toBe('아젠다\n1. 진행상황, 검토');
    expect(timed.location).toBe('새빛관 401');
  });

  it('RRULE에서 UNTIL 분리', () => {
    const [, timed] = parseIcs(SAMPLE);
    expect(timed.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(timed.rruleUntil).toEqual({ date: '2026-12-21', time: '00:00:00', utc: true });
  });

  it('접힌 줄(folded line) 펼침', () => {
    const folded = 'BEGIN:VEVENT\r\nSUMMARY:긴 제\r\n 목입니다\r\nDTSTART:20260101T000000Z\r\nEND:VEVENT';
    expect(parseIcs(folded)[0].title).toBe('긴 제목입니다');
  });

  it('제목/시작 없는 VEVENT는 건너뜀', () => {
    const broken = 'BEGIN:VEVENT\r\nSUMMARY:껍데기\r\nEND:VEVENT';
    expect(parseIcs(broken)).toHaveLength(0);
  });
});

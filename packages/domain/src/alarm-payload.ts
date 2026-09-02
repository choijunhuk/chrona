/**
 * AlarmPayload — 알람 표시에 필요한 모든 데이터 (마스터 §3.5).
 *
 * 앱이 완전 종료된 상태에서 알람이 뜰 때는 DB/네트워크 조회가 불가능하므로,
 * /alarm-ring 화면은 이 payload만으로 렌더링을 완성해야 한다. 협상 불가 규칙.
 */
export type AlarmPayload = {
  eventId: string;
  occurrenceStart: string; // ISO 8601
  title: string;
  timeLabel: string; // '오후 9:00' — 예약 시점에 미리 포맷
  colorHex: string;
  snoozeMinutes: number;
  maxSnooze: number;
  currentSnoozeCount: number;
  soundKey: string;
};

/** Notifee notification.data 는 Record<string, string> 만 허용 → 숫자 필드를 문자열로 직렬화 */
export type SerializedAlarmPayload = Record<keyof AlarmPayload, string>;

export function serializeAlarmPayload(p: AlarmPayload): SerializedAlarmPayload {
  return {
    eventId: p.eventId,
    occurrenceStart: p.occurrenceStart,
    title: p.title,
    timeLabel: p.timeLabel,
    colorHex: p.colorHex,
    snoozeMinutes: String(p.snoozeMinutes),
    maxSnooze: String(p.maxSnooze),
    currentSnoozeCount: String(p.currentSnoozeCount),
    soundKey: p.soundKey,
  };
}

/** 알림에서 넘어온 data를 파싱. 필드 누락 시 안전한 기본값 (알람은 어떻게든 떠야 한다) */
export function parseAlarmPayload(data: Record<string, unknown> | undefined): AlarmPayload {
  const d = data ?? {};
  const str = (k: string, fallback: string) => {
    const v = d[k];
    return typeof v === 'string' && v.length > 0 ? v : fallback;
  };
  const num = (k: string, fallback: number) => {
    const v = d[k];
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    eventId: str('eventId', ''),
    occurrenceStart: str('occurrenceStart', ''),
    title: str('title', '알람'),
    timeLabel: str('timeLabel', ''),
    colorHex: str('colorHex', '#6C7BFF'),
    snoozeMinutes: num('snoozeMinutes', 5),
    maxSnooze: num('maxSnooze', 3),
    currentSnoozeCount: num('currentSnoozeCount', 0),
    soundKey: str('soundKey', 'default'),
  };
}

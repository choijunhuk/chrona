/**
 * 알람 시각 산출 — 이 스테이지의 두뇌 (stage-3 §1-1). 순수 TS, RN 의존 0.
 *
 * 기준 시각 규칙 (stage-3 §1-2, 상수 고정 — 설정화하지 않는다):
 * - 종일 일정: 해당 날짜 09:00(로컬)
 * - task: due_at. (미래: 날짜만 있으면 23:59)
 */
import type { AlarmPayload } from './alarm-payload';
import { fromDateOnly, formatTimeLabel } from './time';
import type { ChronaEvent, EventOverride, Reminder, StandaloneAlarm } from './types';

export const ALL_DAY_BASE_HOUR = 9; // 종일 일정 알람 기준 09:00
export const ALARM_LIMIT = 30; // master §3.6

export type Occurrence = {
  eventId: string;
  title: string;
  colorHex: string | null;
  start: Date;
  end: Date | null;
};

export type PlannedAlarm = {
  payload: AlarmPayload;
  fireAt: Date;
  mode: 'notify' | 'alarm';
};

/**
 * 반복 전개 (Stage 5에서 rrule 연결 — 지금은 단일 일정 pass-through).
 * override 반영: is_cancelled 회차 제외, 시각 변경 회차 교체 (master §3.7).
 */
export function expandOccurrences(
  events: ChronaEvent[],
  range: { from: Date; to: Date },
  overrides: EventOverride[],
  tz: string
): Occurrence[] {
  const byEvent = new Map<string, EventOverride[]>();
  for (const o of overrides) {
    byEvent.set(o.eventId, [...(byEvent.get(o.eventId) ?? []), o]);
  }

  const out: Occurrence[] = [];
  for (const e of events) {
    let start: Date | null = null;
    let end: Date | null = null;

    if (e.kind === 'task') {
      // task는 due_at 기준
      start = e.dueAt;
      end = null;
      if (e.isDone) continue; // 완료된 과제는 알람 없음
    } else if (e.allDay && e.startDate) {
      // 종일: 해당 날짜 09:00 로컬 (§1-2)
      const base = fromDateOnly(e.startDate, tz);
      start = new Date(base.getTime() + ALL_DAY_BASE_HOUR * 3600_000);
      end = null;
    } else {
      start = e.startsAt;
      end = e.endsAt;
    }
    if (!start) continue;

    // 단일 일정의 override: original_start가 원래 시각과 일치하는 것 적용
    const ovs = byEvent.get(e.id) ?? [];
    const ov = ovs.find((o) => o.originalStart.getTime() === start!.getTime());
    if (ov) {
      if (ov.isCancelled) continue;
      if (ov.newStart) {
        start = ov.newStart;
        end = ov.newEnd;
      }
    }

    if (start.getTime() < range.from.getTime() || start.getTime() > range.to.getTime()) continue;
    out.push({ eventId: e.id, title: e.title, colorHex: e.color, start, end });
  }
  return out;
}

/** 순수 알람(standalone)의 발화 시각들을 [now, until] 구간에서 전개 */
export function expandStandaloneAlarms(
  alarms: StandaloneAlarm[],
  now: Date,
  until: Date,
  tz: string
): { alarm: StandaloneAlarm; fireAt: Date }[] {
  const out: { alarm: StandaloneAlarm; fireAt: Date }[] = [];
  for (const a of alarms) {
    if (!a.enabled) continue;
    const [h, m] = a.time.split(':').map(Number);
    // now 기준 오늘(로컬)부터 60일 스캔
    for (let d = 0; d < 60; d++) {
      const day = new Date(now.getTime() + d * 86400_000);
      const local = localParts(day, tz);
      const fire = zonedTime(local.y, local.mo, local.d, h, m, tz);
      if (fire.getTime() <= now.getTime() || fire.getTime() > until.getTime()) continue;
      if (a.weekdays.length > 0) {
        // 0=일 ~ 6=토 (DB 규약)
        const weekday = Number(
          new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
            .format(fire)
            .match(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/)![0]
            .replace('Sun', '0')
            .replace('Mon', '1')
            .replace('Tue', '2')
            .replace('Wed', '3')
            .replace('Thu', '4')
            .replace('Fri', '5')
            .replace('Sat', '6')
        );
        if (!a.weekdays.includes(weekday)) continue;
      } else if (out.some((x) => x.alarm.id === a.id)) {
        break; // 1회성: 첫 발화만
      }
      out.push({ alarm: a, fireAt: fire });
    }
  }
  return out;
}

function localParts(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d); // 'YYYY-MM-DD'
  const [y, mo, day] = parts.split('-').map(Number);
  return { y, mo, d: day };
}

function zonedTime(y: number, mo: number, d: number, h: number, m: number, tz: string): Date {
  // fromDateOnly가 tz의 자정을 주므로 시각을 더한다 (DST 경계는 KST에 없음 — 고정 오프셋 가정)
  const midnight = fromDateOnly(
    `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` as Parameters<
      typeof fromDateOnly
    >[0],
    tz
  );
  return new Date(midnight.getTime() + h * 3600_000 + m * 60_000);
}

export type ScheduleSettings = {
  snoozeMinutes: number;
  maxSnoozeCount: number;
  defaultSoundKey: string;
  tz: string;
};

/**
 * 알람 시각 산출 (master §3.7):
 * occurrence × reminder + 순수 알람 → 과거 제외 → 오름차순 → 상위 limit건.
 */
export function computeAlarmTimes(
  occurrences: Occurrence[],
  reminders: Reminder[],
  standalone: { alarm: StandaloneAlarm; fireAt: Date }[],
  now: Date,
  limit: number,
  settings: ScheduleSettings
): PlannedAlarm[] {
  const byEvent = new Map<string, Reminder[]>();
  for (const r of reminders) {
    if (!r.enabled) continue;
    byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r]);
  }

  const planned: PlannedAlarm[] = [];

  for (const occ of occurrences) {
    for (const r of byEvent.get(occ.eventId) ?? []) {
      const fireAt = new Date(occ.start.getTime() - r.offsetMinutes * 60_000);
      if (fireAt.getTime() <= now.getTime()) continue;
      planned.push({
        fireAt,
        mode: r.mode,
        payload: {
          eventId: occ.eventId,
          occurrenceStart: occ.start.toISOString(),
          title: occ.title,
          timeLabel: formatTimeLabel(occ.start, settings.tz),
          colorHex: occ.colorHex ?? '#6C7BFF',
          snoozeMinutes: settings.snoozeMinutes,
          maxSnooze: settings.maxSnoozeCount,
          currentSnoozeCount: 0,
          soundKey: r.soundKey || settings.defaultSoundKey,
        },
      });
    }
  }

  for (const { alarm, fireAt } of standalone) {
    if (fireAt.getTime() <= now.getTime()) continue;
    planned.push({
      fireAt,
      mode: 'alarm',
      payload: {
        eventId: `standalone:${alarm.id}`,
        occurrenceStart: fireAt.toISOString(),
        title: alarm.label || '알람',
        timeLabel: formatTimeLabel(fireAt, settings.tz),
        colorHex: '#6C7BFF',
        snoozeMinutes: settings.snoozeMinutes,
        maxSnooze: settings.maxSnoozeCount,
        currentSnoozeCount: 0,
        soundKey: alarm.soundKey || settings.defaultSoundKey,
      },
    });
  }

  planned.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return planned.slice(0, limit);
}

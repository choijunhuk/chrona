/**
 * 화면 표시용 전개 (stage-5 §1-5) — 캘린더/홈이 소비한다.
 * 알람용 Occurrence(schedule.ts)와 달리 원본 이벤트 참조와 종일 정보를 유지한다.
 * 전개는 항상 표시 범위로 제한 (전체 전개 금지 — DoD).
 */
import { expandRule } from './recurrence';
import { addDaysOnly } from './calendar';
import { fromDateOnly, toDateOnly, type DateOnly } from './time';
import type { ChronaEvent, EventOverride } from './types';

export type DisplayItem = {
  event: ChronaEvent;
  /** 시각 일정/과제의 시작 (종일이면 null) */
  start: Date | null;
  end: Date | null;
  /** 종일 일정의 날짜 범위 (시각 일정이면 null) — §7.2: date 문자열 유지 */
  startDate: DateOnly | null;
  endDate: DateOnly | null;
};

export function expandForDisplay(
  events: ChronaEvent[],
  overrides: EventOverride[],
  range: { from: Date; to: Date },
  tz: string
): DisplayItem[] {
  const ovByKey = new Map<string, EventOverride>();
  for (const o of overrides) ovByKey.set(`${o.eventId}:${o.originalStart.getTime()}`, o);

  const out: DisplayItem[] = [];
  const pushTimed = (e: ChronaEvent, start: Date, end: Date | null) => {
    // override 반영 (시각 일정 회차 기준)
    const ov = ovByKey.get(`${e.id}:${start.getTime()}`);
    if (ov) {
      if (ov.isCancelled) return;
      if (ov.newStart) {
        const durationMs = end ? end.getTime() - start.getTime() : null;
        start = ov.newStart;
        end = ov.newEnd ?? (durationMs !== null ? new Date(start.getTime() + durationMs) : null);
      }
    }
    if (start.getTime() > range.to.getTime()) return;
    if ((end ?? start).getTime() < range.from.getTime()) return;
    out.push({ event: e, start, end, startDate: null, endDate: null });
  };

  const rangeFromDate = toDateOnly(range.from, tz);
  const rangeToDate = toDateOnly(range.to, tz);

  for (const e of events) {
    if (e.kind === 'task') {
      if (!e.dueAt) continue;
      if (e.dueAt.getTime() < range.from.getTime() || e.dueAt.getTime() > range.to.getTime())
        continue;
      out.push({ event: e, start: e.dueAt, end: null, startDate: null, endDate: null });
      continue;
    }

    if (e.allDay && e.startDate) {
      const span = e.endDate
        ? Math.round(
            (fromDateOnly(e.endDate, tz).getTime() - fromDateOnly(e.startDate, tz).getTime()) /
              86400_000
          )
        : 0;
      if (e.rrule) {
        // 종일 반복: date 기준 전개 (시각 개입 금지 — stage-5 §1-1)
        const starts = expandRule(e.rrule, fromDateOnly(e.startDate, tz), e.rruleUntil, range, tz);
        for (const s0 of starts) {
          const ov = ovByKey.get(`${e.id}:${s0.getTime()}`);
          if (ov?.isCancelled) continue;
          // 회차 이동 override도 반영 — 종일은 날짜만 취한다 (§7.2: 시각 개입 금지)
          const sd = toDateOnly(ov?.newStart ?? s0, tz);
          out.push({
            event: e,
            start: null,
            end: null,
            startDate: sd,
            endDate: span > 0 ? addDaysOnly(sd, span) : sd,
          });
        }
      } else {
        if (e.startDate > rangeToDate || (e.endDate ?? e.startDate) < rangeFromDate) continue;
        out.push({ event: e, start: null, end: null, startDate: e.startDate, endDate: e.endDate ?? e.startDate });
      }
      continue;
    }

    if (!e.startsAt) continue;
    const durationMs = e.endsAt ? e.endsAt.getTime() - e.startsAt.getTime() : null;
    if (e.rrule) {
      const starts = expandRule(e.rrule, e.startsAt, e.rruleUntil, range, tz);
      for (const start of starts) {
        pushTimed(e, start, durationMs !== null ? new Date(start.getTime() + durationMs) : null);
      }
    } else {
      pushTimed(e, e.startsAt, e.endsAt);
    }
  }

  out.sort((a, b) => {
    const at = a.start ? a.start.getTime() : fromDateOnly(a.startDate!, tz).getTime();
    const bt = b.start ? b.start.getTime() : fromDateOnly(b.startDate!, tz).getTime();
    return at - bt;
  });
  return out;
}

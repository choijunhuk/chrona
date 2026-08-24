/**
 * rrule 전개 + override 병합 — 순수 TS (stage-5 §1-1·1-2).
 *
 * 시간대 처리: rrule 패키지는 UTC 기준으로 동작한다. dtstart를 "타임존 벽시계"로
 * 위장(fake-UTC)해서 넣고, 결과를 실제 UTC 시각으로 되돌린다. 이러면 DST가 있는
 * 시간대(웹/Stage 10)에서도 "매주 화 09:00"이 벽시계 기준으로 유지된다.
 */
import { RRule } from 'rrule';

import type { Occurrence } from './schedule';
import type { EventOverride } from './types';

/** 실제 Date → 해당 tz 벽시계 성분을 UTC인 척 담은 Date */
function toFakeUtc(d: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return new Date(
    Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  );
}

/** fake-UTC Date → 실제 UTC Date (해당 tz 벽시계로 해석) */
function fromFakeUtc(fake: Date, tz: string): Date {
  // tz 오프셋은 시각에 따라 다르므로(DST) 후보 시각에서 역산한다
  const guess = new Date(fake.getTime());
  for (let i = 0; i < 3; i++) {
    const seen = toFakeUtc(guess, tz);
    const diff = fake.getTime() - seen.getTime();
    if (diff === 0) return guess;
    guess.setTime(guess.getTime() + diff);
  }
  return guess;
}

/**
 * rrule 문자열을 [range.from, range.to] 구간에서 전개.
 * until이 있으면 거기서도 잘린다. 항상 유한 (stage-5 §1-1).
 */
export function expandRule(
  rruleStr: string,
  dtstart: Date,
  until: Date | null,
  range: { from: Date; to: Date },
  tz: string
): Date[] {
  const options = RRule.parseString(rruleStr);
  options.dtstart = toFakeUtc(dtstart, tz);
  if (until) options.until = toFakeUtc(until, tz);
  const rule = new RRule(options);

  const fakeFrom = toFakeUtc(range.from, tz);
  const fakeTo = toFakeUtc(range.to, tz);
  return rule.between(fakeFrom, fakeTo, true).map((fake) => fromFakeUtc(fake, tz));
}

/**
 * override 병합 (stage-5 §1-2, master §3.7):
 * - original_start(ms 정밀도)로 회차 식별
 * - is_cancelled → 제거
 * - new_start → 교체. range 밖으로 나가면 제거, 밖→안 이동은 추가
 * - 시각·취소만 다룬다 (제목/색은 원본 유지)
 */
export function applyOverrides(
  occurrences: Occurrence[],
  overrides: EventOverride[],
  range: { from: Date; to: Date }
): Occurrence[] {
  if (overrides.length === 0) return occurrences;

  const byKey = new Map<string, EventOverride>();
  for (const o of overrides) {
    byKey.set(`${o.eventId}:${o.originalStart.getTime()}`, o);
  }

  const out: Occurrence[] = [];
  const consumed = new Set<EventOverride>();

  for (const occ of occurrences) {
    const ov = byKey.get(`${occ.eventId}:${occ.start.getTime()}`);
    if (!ov) {
      out.push(occ);
      continue;
    }
    consumed.add(ov);
    if (ov.isCancelled) continue;
    if (ov.newStart) {
      const t = ov.newStart.getTime();
      if (t < range.from.getTime() || t > range.to.getTime()) continue; // 밖으로 이동 → 제거
      const durationMs =
        occ.end && !ov.newEnd ? occ.end.getTime() - occ.start.getTime() : null;
      out.push({
        ...occ,
        start: ov.newStart,
        end: ov.newEnd ?? (durationMs !== null ? new Date(t + durationMs) : occ.end),
      });
    } else {
      out.push(occ);
    }
  }

  // range 밖 회차를 안으로 이동시킨 override: 원본 전개에 없으므로 별도 추가.
  // occurrence 원형(제목 등)은 같은 event의 아무 회차에서 복제한다.
  const templates = new Map<string, Occurrence>();
  for (const occ of occurrences) {
    if (!templates.has(occ.eventId)) templates.set(occ.eventId, occ);
  }
  for (const o of overrides) {
    if (consumed.has(o) || o.isCancelled || !o.newStart) continue;
    const t = o.newStart.getTime();
    if (t < range.from.getTime() || t > range.to.getTime()) continue;
    const tpl = templates.get(o.eventId);
    if (!tpl) continue; // 이 range에 원본 회차가 하나도 없으면 복제 불가 — 드묾, 스킵
    out.push({ ...tpl, start: o.newStart, end: o.newEnd });
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

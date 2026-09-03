/**
 * 재계산 엔진 (stage-3 §1-3, master §3.6·§3.7).
 *
 * 항상: 스냅샷 로드 → 전개 → 상위 30건 산출 → 전체 취소 → 전체 재예약 → 앵커 재예약.
 * 부분 갱신 금지. headless(부팅/앵커)에서도 동작 — 네트워크 의존 없음(스냅샷).
 */
import { formatTimeLabel, resolveTimezone, toDateOnly } from '@/domain/time';
import {
  ALARM_LIMIT,
  alarmKey,
  applyAlarmFilters,
  computeAlarmTimes,
  expandOccurrences,
  expandStandaloneAlarms,
} from '@/domain/schedule';
import { getLocalSettings, setLocalSettings } from '@/data/local-settings';
import { readRescheduleSource, refreshRescheduleSource } from '@/data/reschedule-source';
import { writePlannedCache } from '@/native/planned-cache';
import { pushWidgetData } from '@/native/widget';
import {
  cancelAllTriggers,
  cancelOngoing,
  isAlarmRinging,
  scheduleBriefing,
  scheduleAlarm,
  scheduleMidnightAnchor,
  schedulePreAlarm,
  scheduleReminder,
  showOngoing,
} from '@/native/alarm';

/** 방해금지 해제 시각 앵커 — 자정 앵커와 별개 id라 서로 덮어쓰지 않는다 */
export const QUIET_ANCHOR_ID = 'chrona-anchor-quiet';

export type RescheduleResult = {
  scheduled: number;
  nextAt: Date | null;
  source: 'fresh' | 'snapshot' | 'none';
};

let running: Promise<RescheduleResult> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 실제 재계산 본체 */
async function run(refresh: boolean): Promise<RescheduleResult> {
  // 알람이 울리는 중이면 재계산을 미룬다 — 해제/스누즈 흐름과 충돌 방지
  if (await isAlarmRinging()) {
    console.log('[chrona] reschedule deferred: alarm ringing');
    setTimeout(() => void rescheduleAll({ refresh }), 30_000);
    return { scheduled: -1, nextAt: null, source: 'none' };
  }

  // 온라인이면 스냅샷 갱신 시도, 실패/오프라인이면 기존 스냅샷
  let source = refresh ? await refreshRescheduleSource() : null;
  let origin: RescheduleResult['source'] = source ? 'fresh' : 'snapshot';
  if (!source) source = await readRescheduleSource();
  if (!source) {
    // 데이터 없음(첫 실행 등) — 앵커만 유지
    await cancelAllTriggers();
    await scheduleMidnightAnchor();
    console.log('[chrona] reschedule: no source, anchor only');
    return { scheduled: 0, nextAt: null, source: 'none' };
  }

  const now = new Date();
  const until = new Date(now.getTime() + 60 * 86400_000); // 60일 창 (master §3.7)
  const tz = resolveTimezone(source.settings);
  const local = await getLocalSettings();

  const occurrences = expandOccurrences(source.events, { from: now, to: until }, source.overrides, tz);
  const standalone = expandStandaloneAlarms(source.standaloneAlarms, now, until, tz);
  const computed = computeAlarmTimes(occurrences, source.reminders, standalone, now, ALARM_LIMIT, {
    snoozeMinutes: source.settings?.snoozeMinutes ?? 5,
    maxSnoozeCount: source.settings?.maxSnoozeCount ?? 3,
    defaultSoundKey: source.settings?.defaultSoundKey ?? 'default',
    tz,
  });

  // 방해금지(방학 모드) + "이번만 건너뛰기" 필터 (stage-13 §7)
  const quietUntil = local.quietUntil ? new Date(local.quietUntil) : null;
  const { planned, liveSkippedKeys } = applyAlarmFilters(computed, {
    now,
    quietUntil,
    skippedKeys: local.skippedAlarmKeys,
  });
  if (
    liveSkippedKeys.length !== local.skippedAlarmKeys.length ||
    liveSkippedKeys.some((k) => !local.skippedAlarmKeys.includes(k))
  ) {
    await setLocalSettings({ skippedAlarmKeys: liveSkippedKeys });
  }

  // ★ 전체 취소 후 재예약 (부분 갱신 금지)
  await cancelAllTriggers();
  for (const p of planned) {
    if (p.mode === 'alarm') await scheduleAlarm(p.payload, p.fireAt);
    else await scheduleReminder(p.payload, p.fireAt);
  }
  // 순수 알람(기상용) N분 전 예고 — 저중요도 알림 + 약한 진동 (stage-14, rusty-alarm PreAlarm 이식)
  if (local.preAlarmMinutes > 0) {
    for (const p of planned) {
      if (p.mode !== 'alarm' || !p.payload.eventId.startsWith('standalone:')) continue;
      const preAt = new Date(p.fireAt.getTime() - local.preAlarmMinutes * 60_000);
      if (preAt.getTime() > now.getTime()) await schedulePreAlarm(p.payload, preAt, local.preAlarmMinutes);
    }
  }
  await scheduleMidnightAnchor();
  // 방해금지 해제 시각에도 앵커를 걸어둔다 — 앱을 열지 않아도 알람이 되살아나야 한다
  if (quietUntil && quietUntil.getTime() > now.getTime()) {
    await scheduleMidnightAnchor(quietUntil, QUIET_ANCHOR_ID);
  }
  await writePlannedCache(planned, alarmKey);

  // 브리핑 (stage-6 §2): 내용은 지금(예약 시점) 생성 — 발화 시 DB 조회 없음 (master §3.5)
  if (source.settings?.briefingEnabled ?? true) {
    const [bh, bm] = (source.settings?.briefingTime ?? '23:00').split(':').map(Number);
    const briefAt = new Date(now);
    briefAt.setHours(bh, bm, 0, 0);
    if (briefAt.getTime() <= now.getTime()) briefAt.setDate(briefAt.getDate() + 1);

    const tomorrowStart = new Date(briefAt);
    tomorrowStart.setHours(24, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrowStart.getTime() + 86400_000);
    const tomorrows = occurrences
      .filter((o) => o.start >= tomorrowStart && o.start < tomorrowEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const dueSoon = source.events.filter(
      (e) =>
        e.kind === 'task' &&
        !e.isDone &&
        e.dueAt &&
        e.dueAt.getTime() - now.getTime() < 3 * 86400_000 &&
        e.dueAt.getTime() > now.getTime()
    );
    const lines: string[] = [];
    lines.push(
      tomorrows.length === 0
        ? '내일은 일정이 없어요'
        : `내일 일정 ${tomorrows.length}개 · 첫 일정 ${formatTimeLabel(tomorrows[0].start, tz)}`
    );
    if (tomorrows.length > 0) {
      lines.push(tomorrows.slice(0, 3).map((o) => o.title).join(' · '));
    }
    if (dueSoon.length > 0) {
      lines.push(`마감 임박: ${dueSoon.map((e) => e.title).slice(0, 2).join(', ')}`);
    }
    await scheduleBriefing(lines.join('\n'), briefAt);
  }

  // 아침 브리핑 (stage-11): 기기 로컬 설정. 저녁 브리핑과 같은 조용한 알림, 내용은 그날 기준
  // 브리핑은 조용한 알림이라 방해금지의 영향을 받지 않는다 (stage-13 §7)
  if (local.morningBriefingEnabled) {
    const [mh, mm] = local.morningBriefingTime.split(':').map(Number);
    const morningAt = new Date(now);
    morningAt.setHours(mh, mm, 0, 0);
    if (morningAt.getTime() <= now.getTime()) morningAt.setDate(morningAt.getDate() + 1);

    const dayStart = new Date(morningAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const todays = occurrences
      .filter((o) => o.start >= morningAt && o.start < dayEnd && o.start >= dayStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const dueToday = source.events.filter(
      (e) =>
        e.kind === 'task' &&
        !e.isDone &&
        e.dueAt &&
        e.dueAt >= dayStart &&
        e.dueAt < dayEnd
    );
    const mLines: string[] = [];
    mLines.push(
      todays.length === 0
        ? '오늘은 일정이 없어요'
        : `오늘 일정 ${todays.length}개 · 첫 일정 ${formatTimeLabel(todays[0].start, tz)}`
    );
    if (todays.length > 0) mLines.push(todays.slice(0, 3).map((o) => o.title).join(' · '));
    if (dueToday.length > 0) {
      mLines.push(`오늘 마감: ${dueToday.map((e) => e.title).slice(0, 2).join(', ')}`);
    }
    await scheduleBriefing(mLines.join('\n'), morningAt, {
      id: 'chrona-briefing-morning',
      title: '오늘 브리핑',
    });
  }

  // 상시 알림(③): 오늘 남은 일정 요약 — CRUD·자정 시점에만 갱신 (master §6)
  if (source.settings?.ongoingEnabled) {
    const today = toDateOnly(now, tz);
    const todays = occurrences
      .filter((o) => toDateOnly(o.start, tz) === today && o.start.getTime() > now.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const body =
      todays.length === 0
        ? '오늘 남은 일정이 없습니다'
        : `남은 일정 ${todays.length}건 · 다음: ${todays[0].title} ${formatTimeLabel(todays[0].start, tz)}`;
    await showOngoing('오늘 일정', body);
  } else {
    await cancelOngoing();
  }
  // 위젯 데이터 write + 갱신 (stage-9 — Stage 3 훅 채움)
  await pushWidgetData(occurrences, source.events, tz);

  const nextAt = planned[0]?.fireAt ?? null;
  console.log(
    `[chrona] rescheduled ${planned.length} alarms (${origin}), next: ${nextAt?.toISOString() ?? 'none'}`
  );
  return { scheduled: planned.length, nextAt, source: origin };
}

/** 재계산 실행 (동시 실행 방지). refresh=true면 서버 스냅샷 갱신 먼저 시도 */
export function rescheduleAll(opts?: { refresh?: boolean }): Promise<RescheduleResult> {
  if (running) return running;
  running = run(opts?.refresh ?? true).finally(() => {
    running = null;
  });
  return running;
}

/** CRUD 연쇄용 debounce (300ms trailing, stage-3 §1-3) */
export function rescheduleDebounced(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void rescheduleAll();
  }, 300);
}

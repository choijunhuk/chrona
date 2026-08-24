/**
 * 재계산 엔진 (stage-3 §1-3, master §3.6·§3.7).
 *
 * 항상: 스냅샷 로드 → 전개 → 상위 30건 산출 → 전체 취소 → 전체 재예약 → 앵커 재예약.
 * 부분 갱신 금지. headless(부팅/앵커)에서도 동작 — 네트워크 의존 없음(스냅샷).
 */
import { formatTimeLabel, resolveTimezone, toDateOnly } from '@/domain/time';
import {
  ALARM_LIMIT,
  computeAlarmTimes,
  expandOccurrences,
  expandStandaloneAlarms,
} from '@/domain/schedule';
import { readRescheduleSource, refreshRescheduleSource } from '@/data/reschedule-source';
import {
  cancelAllTriggers,
  cancelOngoing,
  isAlarmRinging,
  scheduleAlarm,
  scheduleMidnightAnchor,
  scheduleReminder,
  showOngoing,
} from '@/native/alarm';

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

  const occurrences = expandOccurrences(source.events, { from: now, to: until }, source.overrides, tz);
  const standalone = expandStandaloneAlarms(source.standaloneAlarms, now, until, tz);
  const planned = computeAlarmTimes(occurrences, source.reminders, standalone, now, ALARM_LIMIT, {
    snoozeMinutes: source.settings?.snoozeMinutes ?? 5,
    maxSnoozeCount: source.settings?.maxSnoozeCount ?? 3,
    defaultSoundKey: source.settings?.defaultSoundKey ?? 'default',
    tz,
  });

  // ★ 전체 취소 후 재예약 (부분 갱신 금지)
  await cancelAllTriggers();
  for (const p of planned) {
    if (p.mode === 'alarm') await scheduleAlarm(p.payload, p.fireAt);
    else await scheduleReminder(p.payload, p.fireAt);
  }
  await scheduleMidnightAnchor();

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
  // TODO(Stage 9): 위젯용 SharedPreferences write

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

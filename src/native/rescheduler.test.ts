/**
 * 재계산 엔진 (master §3.6·§3.7, stage-13 §7).
 *
 * 네이티브 경계(notifee·widget·AsyncStorage)는 전부 목이다. 검증 대상은 "무엇을 몇 건,
 * 어떤 순서로, 무엇을 걸러내고 예약하는가" — 실기기 없이 회귀를 잡을 수 있는 유일한 층.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLocalSettings, setLocalSettings } from '@/data/local-settings';
import { readRescheduleSource, refreshRescheduleSource } from '@/data/reschedule-source';
import type { ChronaEvent, Reminder } from '@/domain/types';
import {
  cancelAllTriggers,
  isAlarmRinging,
  scheduleAlarm,
  scheduleMidnightAnchor,
  schedulePreAlarm,
  scheduleReminder,
} from '@/native/alarm';
import { writePlannedCache } from '@/native/planned-cache';
import { QUIET_ANCHOR_ID, rescheduleAll } from '@/native/rescheduler';

type LocalSettings = {
  morningBriefingEnabled: boolean;
  morningBriefingTime: string;
  gradualVolume: boolean;
  examMode: boolean;
  quietUntil: string | null;
  skippedAlarmKeys: string[];
  alarmTimeoutMinutes: number;
};

const LOCAL_BASE: LocalSettings = {
  morningBriefingEnabled: false,
  morningBriefingTime: '08:00',
  gradualVolume: false,
  examMode: false,
  quietUntil: null,
  skippedAlarmKeys: [],
  alarmTimeoutMinutes: 10,
};

// vi.mock 팩토리는 import보다 먼저 평가되므로 상태 홀더도 hoist해야 TDZ에 걸리지 않는다
const state = vi.hoisted(() => ({ local: null as unknown }));

vi.mock('@notifee/react-native', () => ({ default: {} }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

vi.mock('@/native/alarm', () => ({
  cancelAllTriggers: vi.fn(async () => undefined),
  cancelOngoing: vi.fn(async () => undefined),
  isAlarmRinging: vi.fn(async () => false),
  scheduleAlarm: vi.fn(async () => 'id'),
  scheduleBriefing: vi.fn(async () => 'id'),
  scheduleMidnightAnchor: vi.fn(async () => 'id'),
  schedulePreAlarm: vi.fn(async () => 'id'),
  scheduleReminder: vi.fn(async () => 'id'),
  showOngoing: vi.fn(async () => undefined),
}));

vi.mock('@/native/widget', () => ({ pushWidgetData: vi.fn(async () => undefined) }));

vi.mock('@/native/planned-cache', () => ({ writePlannedCache: vi.fn(async () => undefined) }));

vi.mock('@/data/reschedule-source', () => ({
  readRescheduleSource: vi.fn(async () => null),
  refreshRescheduleSource: vi.fn(async () => null),
}));

vi.mock('@/data/local-settings', () => ({
  getLocalSettings: vi.fn(async () => state.local),
  setLocalSettings: vi.fn(async (patch: Partial<LocalSettings>) => {
    state.local = { ...(state.local as LocalSettings), ...patch };
    return state.local;
  }),
}));

const TZ = 'Asia/Seoul';

/** 목이 돌려줄 로컬 설정 (테스트마다 beforeEach에서 초기화) */
function local(): LocalSettings {
  return state.local as LocalSettings;
}

function event(id: string, startsAt: Date): ChronaEvent {
  return {
    id,
    kind: 'schedule',
    title: `일정 ${id}`,
    memo: null,
    categoryId: null,
    color: null,
    allDay: false,
    startsAt,
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
  } as ChronaEvent;
}

function reminder(eventId: string, mode: 'alarm' | 'notify' = 'alarm'): Reminder {
  return {
    id: `r-${eventId}`,
    eventId,
    offsetMinutes: 0,
    mode,
    soundKey: 'default',
    enabled: true,
  } as Reminder;
}

/** now 기준 hoursFromNow 시간 뒤에 시작하는 일정 n건 + 각 1개의 알람 리마인더 */
function sourceWith(count: number, opts?: { firstHours?: number }) {
  const first = opts?.firstHours ?? 1;
  const events = Array.from({ length: count }, (_, i) =>
    event(`e${i}`, new Date(Date.now() + (first + i) * 3600_000))
  );
  return {
    events,
    overrides: [],
    reminders: events.map((e) => reminder(e.id)),
    standaloneAlarms: [],
    settings: {
      briefingEnabled: false,
      ongoingEnabled: false,
      briefingTime: '23:00',
      defaultReminderOffset: 0,
      snoozeMinutes: 5,
      maxSnoozeCount: 3,
      defaultSoundKey: 'default',
      fixedTimezone: TZ,
      theme: 'dark',
      permissionCheckedAt: null,
    },
    syncedAt: new Date().toISOString(),
  };
}

const mocked = {
  read: vi.mocked(readRescheduleSource),
  refresh: vi.mocked(refreshRescheduleSource),
  ringing: vi.mocked(isAlarmRinging),
  cancelAllTriggers: vi.mocked(cancelAllTriggers),
  scheduleAlarm: vi.mocked(scheduleAlarm),
  scheduleReminder: vi.mocked(scheduleReminder),
  schedulePreAlarm: vi.mocked(schedulePreAlarm),
  anchor: vi.mocked(scheduleMidnightAnchor),
  writePlannedCache: vi.mocked(writePlannedCache),
  setLocalSettings: vi.mocked(setLocalSettings),
  getLocalSettings: vi.mocked(getLocalSettings),
};

beforeEach(() => {
  vi.clearAllMocks();
  state.local = { ...LOCAL_BASE, skippedAlarmKeys: [] };
  mocked.ringing.mockResolvedValue(false);
  mocked.refresh.mockResolvedValue(null);
});

/** scheduleAlarm 호출에서 fireAt 만 뽑아낸다 */
function scheduledFireTimes(): number[] {
  return mocked.scheduleAlarm.mock.calls.map((c) => (c[1] as Date).getTime());
}

describe('rescheduleAll', () => {
  it('가장 가까운 30건만, 시각 오름차순으로 예약한다 (master §3.6)', async () => {
    mocked.read.mockResolvedValue(sourceWith(45) as never);

    const result = await rescheduleAll({ refresh: false });

    expect(result.scheduled).toBe(30);
    expect(mocked.scheduleAlarm).toHaveBeenCalledTimes(30);

    const times = scheduledFireTimes();
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // 가장 가까운 30건이므로 31번째(=+31시간) 일정은 잘려나간다
    expect(Math.max(...times)).toBeLessThan(Date.now() + 31 * 3600_000);
  });

  it('알람이 울리는 중이면 아무것도 취소하지 않고 미룬다', async () => {
    vi.useFakeTimers();
    mocked.ringing.mockResolvedValue(true);
    mocked.read.mockResolvedValue(sourceWith(3) as never);

    const result = await rescheduleAll({ refresh: false });

    expect(result.scheduled).toBe(-1);
    expect(mocked.cancelAllTriggers).not.toHaveBeenCalled();
    expect(mocked.scheduleAlarm).not.toHaveBeenCalled();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('방해금지 중이면 창 안의 알람을 걸러내고 해제 시각에 앵커를 건다', async () => {
    const quietUntil = new Date(Date.now() + 5 * 3600_000);
    local().quietUntil = quietUntil.toISOString();
    // +1h ~ +8h 일정 8건 → 앞의 4건(+1~+4h)은 방해금지 창 안이라 제외
    mocked.read.mockResolvedValue(sourceWith(8) as never);

    const result = await rescheduleAll({ refresh: false });

    expect(result.scheduled).toBe(4);
    for (const t of scheduledFireTimes()) {
      expect(t).toBeGreaterThanOrEqual(quietUntil.getTime());
    }
    // 자정 앵커 + 방해금지 해제 앵커
    expect(mocked.anchor).toHaveBeenCalledWith();
    expect(mocked.anchor).toHaveBeenCalledWith(quietUntil, QUIET_ANCHOR_ID);
  });

  it('방해금지가 꺼져 있으면 해제 앵커를 걸지 않는다', async () => {
    mocked.read.mockResolvedValue(sourceWith(2) as never);

    await rescheduleAll({ refresh: false });

    expect(mocked.anchor).toHaveBeenCalledTimes(1);
    expect(mocked.anchor).not.toHaveBeenCalledWith(expect.anything(), QUIET_ANCHOR_ID);
  });

  it('건너뛴 알람은 제외하고, 지나간 건너뛰기 키는 정리한다', async () => {
    const source = sourceWith(3);
    const skippedOcc = source.events[0].startsAt!.toISOString();
    const staleKey = 'e-old|2020-01-01T00:00:00.000Z'; // 과거 → 정리 대상
    local().skippedAlarmKeys = [`e0|${skippedOcc}`, staleKey];
    mocked.read.mockResolvedValue(source as never);

    const result = await rescheduleAll({ refresh: false });

    expect(result.scheduled).toBe(2); // 3건 중 e0 제외
    expect(scheduledFireTimes()).not.toContain(source.events[0].startsAt!.getTime());
    // 유효한 키만 남기고 다시 저장
    expect(mocked.setLocalSettings).toHaveBeenCalledWith({
      skippedAlarmKeys: [`e0|${skippedOcc}`],
    });
  });

  it('필터링된 결과를 planned 캐시에 쓴다 (홈 "다음 알람" 칩이 읽는 소스)', async () => {
    const source = sourceWith(3);
    local().skippedAlarmKeys = [`e0|${source.events[0].startsAt!.toISOString()}`];
    mocked.read.mockResolvedValue(source as never);

    await rescheduleAll({ refresh: false });

    expect(mocked.writePlannedCache).toHaveBeenCalledTimes(1);
    const [planned] = mocked.writePlannedCache.mock.calls[0];
    expect(planned).toHaveLength(2);
    expect(planned.map((p) => p.payload.eventId)).not.toContain('e0');
  });

  it('스누즈 예약은 재계산이 건드리지 않는다 — 취소는 cancelAllTriggers 한 곳에만 위임한다', async () => {
    mocked.read.mockResolvedValue(sourceWith(3) as never);

    await rescheduleAll({ refresh: false });

    // 취소 경로는 스누즈를 건너뛰는 cancelAllTriggers 단 하나 (cancelAll·개별 취소 금지)
    expect(mocked.cancelAllTriggers).toHaveBeenCalledTimes(1);
    // 재계산이 거는 예약은 id를 지정하지 않는다 → 'snooze:' 네임스페이스를 덮어쓸 수 없다
    for (const call of mocked.scheduleAlarm.mock.calls) {
      expect(call[2]).toBeUndefined();
    }
  });

  it('mode=notify 는 알람이 아니라 리마인더로 예약한다', async () => {
    const source = sourceWith(2);
    source.reminders = source.events.map((e) => reminder(e.id, 'notify'));
    mocked.read.mockResolvedValue(source as never);

    await rescheduleAll({ refresh: false });

    expect(mocked.scheduleReminder).toHaveBeenCalledTimes(2);
    expect(mocked.scheduleAlarm).not.toHaveBeenCalled();
  });

  it('preAlarmMinutes>0 이면 순수 알람에만 N분 전 예고를 건다 (일정 알람은 제외)', async () => {
    const source = sourceWith(1, { firstHours: 2 });
    const hhmm = new Date(Date.now() + 3 * 3600_000);
    source.standaloneAlarms = [
      {
        id: 'sa1',
        time: `${String(hhmm.getHours()).padStart(2, '0')}:${String(hhmm.getMinutes()).padStart(2, '0')}`,
        weekdays: [],
        label: '기상',
        enabled: true,
        soundKey: 'default',
        vibrate: true,
      },
    ] as never;
    state.local = { ...local(), preAlarmMinutes: 10 };
    mocked.read.mockResolvedValue(source as never);

    await rescheduleAll({ refresh: false });

    expect(mocked.schedulePreAlarm).toHaveBeenCalledTimes(1);
    const [payload, preAt, minutes] = mocked.schedulePreAlarm.mock.calls[0];
    expect(payload.eventId).toBe('standalone:sa1');
    expect(minutes).toBe(10);
    const fireAt = mocked.scheduleAlarm.mock.calls.find((c) => c[0].eventId === 'standalone:sa1')![1];
    expect(fireAt.getTime() - preAt.getTime()).toBe(10 * 60_000);
  });

  it('스냅샷이 없으면 앵커만 유지한다', async () => {
    mocked.read.mockResolvedValue(null);

    const result = await rescheduleAll({ refresh: false });

    expect(result).toEqual({ scheduled: 0, nextAt: null, source: 'none' });
    expect(mocked.cancelAllTriggers).toHaveBeenCalledTimes(1);
    expect(mocked.anchor).toHaveBeenCalledTimes(1);
  });
});

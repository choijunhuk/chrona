/**
 * Chrona 알람 엔진 — 앱에서 유일한 Notifee 접점 (Stage 0 DoD).
 * 다른 파일은 절대 @notifee/react-native 를 직접 import하지 않는다.
 *
 * - 채널 4종 생성 (마스터 §3.3)
 * - 알람(②) / 리마인더(①) / 상시(③) 예약·표시
 * - 포그라운드 서비스 등록·종료 (울리는 동안만 생존, 마스터 §6)
 * - 자정 앵커 (마스터 §3.6 트리거 4)
 * - 알람 충돌 정책: 새 알람이 이전 알람을 덮어쓴다 (마스터 §3.9)
 */
import notifee, {
  AndroidForegroundServiceType,
  AndroidCategory,
  AndroidImportance,
  AndroidStyle,
  AndroidVisibility,
  AlarmType,
  EventType,
  TriggerType,
  type Event,
  type TriggerNotification,
} from '@notifee/react-native';

import {
  parseAlarmPayload,
  serializeAlarmPayload,
  type AlarmPayload,
} from '@/domain/alarm-payload';

// ─── 알람 사운드 재생 (FGS 보강) ─────────────────────────
// 채널 사운드는 USAGE_NOTIFICATION이라 진동/무음 모드에서 통째로 묵음이 된다.
// 실제 소리는 네이티브 모듈이 USAGE_ALARM + STREAM_ALARM 으로 재생한다 (§3.10).

import {
  isSystemSoundUri,
  listSystemAlarmSounds,
  playSound,
  previewSound as previewSoundNative,
  stopSound,
} from '@/native/alarm-sound';

export const CHANNELS = {
  alarm: 'chrona.alarm',
  reminder: 'chrona.reminder',
  ongoing: 'chrona.ongoing',
  timer: 'chrona.timer',
  prealarm: 'chrona.prealarm',
} as const;

const ONGOING_NOTIFICATION_ID = 'chrona-ongoing';
const ANCHOR_KIND = 'midnight-anchor';
const VIBRATION_PATTERN = [300, 500];
// 예고 알림용 약한 진동. notifee는 0 이하 값을 거부해 [0,250,...] 대신 앞을 200으로 둔다
const PRE_ALARM_VIBRATION_PATTERN = [200, 250, 200, 250, 200, 250];

// ─── 알람음 (마스터 §3.10: 4종 + 무음) ───────────────────

/** 알람음 선택지 — 이벤트 편집기·설정 피커가 공유한다. key는 payload.soundKey */
export const SOUND_OPTIONS: { key: string; label: string }[] = [
  { key: 'default', label: '기본' },
  { key: 'alarm_01', label: '클래식 비프' },
  { key: 'alarm_02', label: '차임' },
  { key: 'alarm_03', label: '디지털' },
  { key: 'alarm_04', label: '벨' },
  { key: 'none', label: '무음(진동)' },
];

/** 기기 벨소리를 합친 전체 목록 캐시 (getSoundOptions가 채운다) */
let soundOptionsCache: { key: string; label: string }[] | null = null;

/**
 * 선택지 = 번들 5종 + 무음 + 기기 알람 벨소리(key=uri).
 * 첫 호출에서 네이티브 조회 후 캐시 — 피커가 매번 조회하지 않게.
 */
export async function getSoundOptions(): Promise<{ key: string; label: string }[]> {
  if (soundOptionsCache) return soundOptionsCache;
  const system = await listSystemAlarmSounds();
  soundOptionsCache = [
    ...SOUND_OPTIONS,
    ...system.map((s) => ({ key: s.uri, label: s.title })),
  ];
  return soundOptionsCache;
}

export function soundLabel(key: string | undefined): string {
  if (isSystemSoundUri(key)) {
    return soundOptionsCache?.find((o) => o.key === key)?.label ?? '시스템 벨소리';
  }
  return SOUND_OPTIONS.find((o) => o.key === key)?.label ?? '기본';
}

/** 피커 미리듣기 (3초). 'none'은 재생할 것이 없다 */
export async function previewSound(key: string): Promise<void> {
  if (key === 'none') return;
  await previewSoundNative(isSystemSoundUri(key) ? key : soundResource(key));
}

export async function stopPreview(): Promise<void> {
  await stopSound();
}

/** 번들 알람음 키 — res/raw 리소스 이름과 1:1 (알림 채널 sound 값과 동일) */
const BUNDLED_SOUND_KEYS = new Set(['default', 'alarm_01', 'alarm_02', 'alarm_03', 'alarm_04']);

/**
 * soundKey → 채널 id. 채널마다 sound가 고정이라 소리 종류만큼 채널이 필요하다.
 * 시스템 벨소리(content://·file://)는 채널을 만들 수 없으므로 기본 알람 채널을 쓰고
 * 실제 소리는 네이티브 재생이 담당한다 (채널 사운드는 기본음 폴백).
 */
function alarmChannelFor(soundKey: string | undefined): string {
  const key =
    soundKey && (BUNDLED_SOUND_KEYS.has(soundKey) || soundKey === 'none') ? soundKey : 'default';
  return key === 'default' ? CHANNELS.alarm : `chrona.alarm.${key}`;
}

// ─── 채널 ───────────────────────────────────────────────

/** 앱 부팅 시 1회. 채널은 생성 후 속성 변경 불가 — 처음부터 정확하게 (마스터 §3.3) */
export async function ensureChannels(): Promise<void> {
  await notifee.createChannel({
    id: CHANNELS.alarm,
    name: '알람',
    importance: AndroidImportance.HIGH,
    bypassDnd: true,
    sound: 'default',
    vibration: true,
    vibrationPattern: VIBRATION_PATTERN,
    visibility: AndroidVisibility.PUBLIC,
  });
  await notifee.createChannel({
    id: CHANNELS.reminder,
    name: '리마인더',
    importance: AndroidImportance.DEFAULT,
    sound: 'default',
  });
  await notifee.createChannel({
    id: CHANNELS.ongoing,
    name: '상시 알림',
    importance: AndroidImportance.LOW,
    badge: false,
  });
  await notifee.createChannel({
    id: CHANNELS.timer,
    name: '타이머',
    importance: AndroidImportance.LOW,
  });
  // 알람 예고(stage-14): 소리 없이 약한 진동만 — 깨우지 않고 "곧 울린다"만 알린다
  await notifee.createChannel({
    id: CHANNELS.prealarm,
    name: '알람 예고',
    importance: AndroidImportance.LOW,
    vibration: true,
    vibrationPattern: PRE_ALARM_VIBRATION_PATTERN,
  });
  // 알람음별 채널 — 채널 sound는 생성 후 변경 불가라 소리 종류마다 채널을 나눈다 (§3.10)
  for (const opt of SOUND_OPTIONS) {
    if (opt.key === 'default') continue;
    await notifee.createChannel({
      id: alarmChannelFor(opt.key),
      name: `알람 (${opt.label})`,
      importance: AndroidImportance.HIGH,
      bypassDnd: true,
      sound: opt.key === 'none' ? undefined : opt.key,
      vibration: true,
      vibrationPattern: VIBRATION_PATTERN,
      visibility: AndroidVisibility.PUBLIC,
    });
  }
}

// ─── 예약 ───────────────────────────────────────────────

/**
 * 알람 모드(②): SET_ALARM_CLOCK + 전체화면 + 끌 때까지 소리.
 * SET_ALARM_CLOCK 이 Doze를 뚫는 유일한 경로 — 다른 타입으로 대체 금지 (Stage 0 §1-5).
 */
export async function scheduleAlarm(
  payload: AlarmPayload,
  fireAt: Date,
  opts?: { id?: string }
): Promise<string> {
  const silent = payload.soundKey === 'none';
  return notifee.createTriggerNotification(
    {
      ...(opts?.id ? { id: opts.id } : {}),
      title: payload.title,
      body: payload.timeLabel,
      data: serializeAlarmPayload(payload),
      android: {
        channelId: alarmChannelFor(payload.soundKey),
        category: AndroidCategory.ALARM,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        fullScreenAction: { id: 'alarm-ring', launchActivity: 'default' },
        pressAction: { id: 'alarm-ring', launchActivity: 'default' },
        actions: alarmActions(payload),
        loopSound: !silent,
        ...(silent ? {} : { sound: soundResource(payload.soundKey) }),
        ongoing: true,
        autoCancel: false,
        asForegroundService: true,
        // shortService(3분 제한) 회피 — manifest 타입은 config plugin이 mediaPlayback으로 덮어씀
        foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK],
        lightUpScreen: true,
        vibrationPattern: VIBRATION_PATTERN,
        color: payload.colorHex,
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: fireAt.getTime(),
      alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
    }
  );
}

/**
 * 알림 액션 버튼 (stage-13 §1): 앱을 열지 않고 해제·스누즈.
 * 스누즈 소진 시 스누즈 버튼을 아예 빼서 "눌러도 아무 일 없음"을 만들지 않는다.
 *
 * 해제 게이트 (stage-15): challenge가 걸린 알람은 '해제' 버튼을 아예 넣지 않는다 —
 * 넣으면 알림 그늘에서 한 번 눌러 게이트를 통째로 우회할 수 있다. 리마인더·일반 알람은 그대로.
 */
function alarmActions(payload: AlarmPayload, opts?: { snooze?: boolean }) {
  const actions =
    payload.challenge === 'none' ? [{ title: '해제', pressAction: { id: 'alarm-dismiss' } }] : [];
  // 조용한 리마인더에 스누즈를 주면 snoozeAlarm이 SET_ALARM_CLOCK 알람으로 승격시킨다 → 리마인더는 해제만
  if ((opts?.snooze ?? true) && payload.currentSnoozeCount < payload.maxSnooze) {
    actions.push({
      title: `스누즈 ${payload.snoozeMinutes}분`,
      pressAction: { id: 'alarm-snooze' },
    });
  }
  return actions.length > 0 ? actions : undefined;
}

/** soundKey → res/raw 리소스 이름 (확장자 없음). 시스템 벨소리·미등록 키는 기본음 */
function soundResource(soundKey: string | undefined): string {
  return soundKey && soundKey !== 'default' && BUNDLED_SOUND_KEYS.has(soundKey)
    ? soundKey
    : 'default';
}

const PRE_ALARM_PREFIX = 'prealarm:';
const PRE_ALARM_KIND = 'pre-alarm';

/**
 * 알람 예고(stage-14): 순수 알람 N분 전 조용한 알림 1건.
 * 재계산 때 일반 트리거와 함께 취소·재생성된다 (cancelAllTriggers가 접두어를 특별 취급하지 않음).
 */
export async function schedulePreAlarm(
  payload: AlarmPayload,
  fireAt: Date,
  minutesBefore: number
): Promise<string> {
  return notifee.createTriggerNotification(
    {
      id: `${PRE_ALARM_PREFIX}${payload.eventId}|${payload.occurrenceStart}`,
      title: `곧 알람 · ${payload.timeLabel}`,
      body: `${minutesBefore}분 후 ${payload.title}`,
      data: { ...serializeAlarmPayload(payload), chronaKind: PRE_ALARM_KIND },
      android: {
        channelId: CHANNELS.prealarm,
        importance: AndroidImportance.LOW,
        autoCancel: true,
        pressAction: { id: 'default', launchActivity: 'default' },
        vibrationPattern: PRE_ALARM_VIBRATION_PATTERN,
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: fireAt.getTime(),
      alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
    }
  );
}

/** 리마인더(①): 한 번 띄우고 끝 */
export async function scheduleReminder(payload: AlarmPayload, fireAt: Date): Promise<string> {
  return notifee.createTriggerNotification(
    {
      title: payload.title,
      body: payload.timeLabel,
      data: serializeAlarmPayload(payload),
      android: {
        channelId: CHANNELS.reminder,
        pressAction: { id: 'default', launchActivity: 'default' },
        actions: alarmActions(payload, { snooze: false }),
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: fireAt.getTime(),
      alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE },
    }
  );
}

/** 상시 고정(③): 스와이프 삭제 불가, 소리 없음 */
export async function showOngoing(title: string, body: string): Promise<void> {
  await notifee.displayNotification({
    id: ONGOING_NOTIFICATION_ID,
    title,
    body,
    android: {
      channelId: CHANNELS.ongoing,
      importance: AndroidImportance.LOW,
      ongoing: true,
      autoCancel: false,
      pressAction: { id: 'default', launchActivity: 'default' },
    },
  });
}

export async function cancelOngoing(): Promise<void> {
  await notifee.cancelNotification(ONGOING_NOTIFICATION_ID);
}

export async function cancelAll(): Promise<void> {
  await stopAlarmSound();
  await notifee.stopForegroundService();
  await notifee.cancelAllNotifications();
}

/**
 * 예약(트리거)만 전체 취소 — 재계산 엔진 전용.
 * ⚠ 인자 없는 cancelTriggerNotifications()는 방금 발화해 표시 중인 알람 알림까지
 * 제거한다 (실기기에서 알람이 울리자마자 사라지는 버그의 원인). 반드시
 * pending id 목록을 뽑아 표시 중인 것을 제외하고 취소한다.
 */
export async function cancelAllTriggers(): Promise<void> {
  const [pendingIds, displayed] = await Promise.all([
    notifee.getTriggerNotificationIds(),
    notifee.getDisplayedNotifications(),
  ]);
  const displayedIds = new Set(displayed.map((d) => d.id));
  // 스누즈는 재계산 대상이 아니다 — 사용자가 방금 "5분 뒤"를 누른 약속이라 살려둔다 (stage-13 §4)
  const toCancel = pendingIds.filter(
    (id) => !displayedIds.has(id) && !isSnoozeId(id) && !isTimeoutId(id)
  );
  if (toCancel.length > 0) {
    await notifee.cancelTriggerNotifications(toCancel);
  }
}

const SNOOZE_PREFIX = 'snooze:';

function isSnoozeId(id: string): boolean {
  return id.startsWith(SNOOZE_PREFIX);
}

/** 같은 occurrence의 스누즈는 1건만 — 새로 걸 때 이전 것을 덮어쓴다 */
function snoozeIdFor(payload: AlarmPayload): string {
  return `${SNOOZE_PREFIX}${payload.eventId}|${payload.occurrenceStart}`;
}

/** 예약된 스누즈만 전부 취소 ("모든 알람 지금 끄기" 전용) */
export async function cancelSnoozes(): Promise<number> {
  const ids = (await notifee.getTriggerNotificationIds()).filter(isSnoozeId);
  if (ids.length > 0) await notifee.cancelTriggerNotifications(ids);
  return ids.length;
}

const TIMEOUT_PREFIX = 'timeout:';
const TIMEOUT_KIND = 'alarm-timeout';

function isTimeoutId(id: string): boolean {
  return id.startsWith(TIMEOUT_PREFIX);
}

/**
 * headless 자동 종료 (stage-13): 알람 발화 시 N분 뒤 무음 트리거를 걸어둔다.
 * /alarm-ring 화면이 안 떴을 때(알림 차단·화면 켜짐·FSI 실패)도 알람이 영원히 울리지 않게 하는 마지막 안전망.
 * AlarmManager가 보장하므로 JS 프로세스가 죽어도 동작한다.
 */
async function scheduleAlarmTimeout(notificationId: string, payload: AlarmPayload): Promise<void> {
  const { getLocalSettings } = await import('@/data/local-settings');
  const minutes = (await getLocalSettings()).alarmTimeoutMinutes;
  if (!(minutes > 0)) return;
  await notifee.createTriggerNotification(
    {
      id: `${TIMEOUT_PREFIX}${notificationId}`,
      title: payload.title,
      body: '알람 자동 종료',
      data: { ...serializeAlarmPayload(payload), chronaKind: TIMEOUT_KIND, target: notificationId },
      android: {
        channelId: CHANNELS.ongoing, // LOW·무음 — 발화 즉시 스스로 취소되는 내부 트리거
        importance: AndroidImportance.MIN,
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: Date.now() + minutes * 60_000,
      alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
    }
  );
}

async function cancelAlarmTimeout(notificationId: string): Promise<void> {
  if (!notificationId) return;
  await notifee.cancelTriggerNotification(`${TIMEOUT_PREFIX}${notificationId}`).catch(() => {});
}

/** 알람 채널 여부 — 알람음별로 채널이 나뉘어 있다 (chrona.alarm / chrona.alarm.*) */
function isAlarmChannel(channelId: string | undefined): boolean {
  return !!channelId && channelId.startsWith(CHANNELS.alarm);
}

/** 알람(②)이 지금 울리는 중인지 — 재계산 지연 판단용 */
export async function isAlarmRinging(): Promise<boolean> {
  const displayed = await notifee.getDisplayedNotifications();
  return displayed.some((n) => isAlarmChannel(n.notification.android?.channelId));
}

export type ScheduledAlarm = {
  id: string;
  title: string;
  fireAt: Date | null;
  isAnchor: boolean;
};

export async function listScheduled(): Promise<ScheduledAlarm[]> {
  const triggers: TriggerNotification[] = await notifee.getTriggerNotifications();
  return triggers.map((t) => ({
    id: t.notification.id ?? '',
    title: t.notification.title ?? '(제목 없음)',
    fireAt: t.trigger.type === TriggerType.TIMESTAMP ? new Date(t.trigger.timestamp) : null,
    isAnchor: t.notification.data?.chronaKind === ANCHOR_KIND,
  }));
}

// ─── 해제 / 스누즈 ──────────────────────────────────────

/** 해제: 소리 정지 + 포그라운드 서비스 즉시 종료 + 알림 제거 (Stage 0 §1-6) */
export async function dismissAlarm(notificationId: string): Promise<void> {
  await stopAlarmSound();
  await notifee.stopForegroundService();
  await cancelAlarmTimeout(notificationId);
  if (notificationId) {
    await notifee.cancelNotification(notificationId);
    return;
  }
  // id 유실(파라미터 누락·헤드리스 복귀) — 표시 중인 알람 알림을 전부 걷어낸다.
  // 여기서 아무것도 안 하면 소리는 멎었는데 알림만 남아 "안 꺼진 알람"으로 보인다.
  const displayed = await notifee.getDisplayedNotifications();
  for (const n of displayed) {
    if (n.id && isAlarmChannel(n.notification.android?.channelId)) {
      await notifee.cancelNotification(n.id);
    }
  }
}

/**
 * 스누즈: 새 SET_ALARM_CLOCK 예약이므로 앱이 죽어도 유지 (마스터 §3.8).
 * 카운트는 payload로만 전달 — DB 왕복 없음.
 * maxSnooze 도달 시 'exhausted' 반환 (호출측에서 놓친 알람 처리).
 */
export async function snoozeAlarm(
  payload: AlarmPayload,
  currentNotificationId: string
): Promise<'scheduled' | 'exhausted'> {
  await dismissAlarm(currentNotificationId);

  if (payload.currentSnoozeCount >= payload.maxSnooze) {
    await postMissedAlarm(payload);
    return 'exhausted';
  }

  const next: AlarmPayload = {
    ...payload,
    currentSnoozeCount: payload.currentSnoozeCount + 1,
  };
  const fireAt = new Date(Date.now() + payload.snoozeMinutes * 60_000);
  const id = snoozeIdFor(payload);
  await notifee.cancelTriggerNotification(id); // 같은 occurrence의 이전 스누즈 정리
  await scheduleAlarm(next, fireAt, { id });
  return 'scheduled';
}

/** 스누즈 소진 시 "놓친 알람" 조용한 알림 1건 (마스터 §3.8) */
export async function postMissedAlarm(payload: AlarmPayload): Promise<void> {
  await notifee.displayNotification({
    title: '놓친 알람',
    body: `${payload.title} (${payload.timeLabel})`,
    android: {
      channelId: CHANNELS.reminder,
      pressAction: { id: 'default', launchActivity: 'default' },
    },
  });
}

// ─── 타이머 알림 (stage-6) ──────────────────────────────

const TIMER_ONGOING_ID = 'chrona-timer';
const TIMER_COMPLETE_ID = 'chrona-timer-complete';

/** 진행 중 상시 표시 — OS chronometer가 카운트다운을 그린다 (JS 갱신 0회) */
export async function showTimerOngoing(title: string, endAt: Date, paused: boolean): Promise<void> {
  await notifee.displayNotification({
    id: TIMER_ONGOING_ID,
    title: paused ? `⏸ ${title}` : `⏱ ${title}`,
    body: paused ? '일시정지됨' : '집중 진행 중',
    data: { chronaKind: 'timer' },
    android: {
      channelId: CHANNELS.timer,
      importance: AndroidImportance.LOW,
      ongoing: true,
      autoCancel: false,
      showChronometer: !paused,
      chronometerDirection: 'down',
      timestamp: endAt.getTime(),
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        {
          title: paused ? '재개' : '일시정지',
          pressAction: { id: paused ? 'timer-resume' : 'timer-pause' },
        },
        { title: '종료', pressAction: { id: 'timer-stop' } },
      ],
    },
  });
}

/** 완료 시 짧은 알람 (3초 — loopSound 없음) */
export async function scheduleTimerComplete(fireAt: Date, title: string): Promise<string> {
  return notifee.createTriggerNotification(
    {
      id: TIMER_COMPLETE_ID,
      title: '집중 완료',
      body: title,
      data: { chronaKind: 'timer-complete' },
      android: {
        channelId: CHANNELS.alarm,
        category: AndroidCategory.ALARM,
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: VIBRATION_PATTERN,
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: fireAt.getTime(),
      alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
    }
  );
}

export async function cancelTimerNotifications(): Promise<void> {
  await notifee.cancelNotification(TIMER_ONGOING_ID);
  await notifee.cancelTriggerNotification(TIMER_COMPLETE_ID);
}

// ─── 브리핑 (stage-6 §2) ────────────────────────────────

/** 조용한 알림 1건. 내용은 예약 시점에 생성돼 문자열로 들어온다 (master §3.5) */
export async function scheduleBriefing(
  body: string,
  fireAt: Date,
  opts?: { id?: string; title?: string }
): Promise<string> {
  return notifee.createTriggerNotification(
    {
      id: opts?.id ?? 'chrona-briefing',
      title: opts?.title ?? '내일 브리핑',
      body,
      data: { chronaKind: 'briefing' },
      android: {
        channelId: CHANNELS.reminder,
        style: { type: AndroidStyle.BIGTEXT, text: body },
        pressAction: { id: 'briefing-open', launchActivity: 'default' },
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: fireAt.getTime(),
      alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE },
    }
  );
}

// ─── 자정 앵커 (마스터 §3.6) ────────────────────────────

/** 다음 자정(로컬)에 앵커 예약. fireAt 을 넘기면 그 시각으로 (디버그용) */
export async function scheduleMidnightAnchor(fireAt?: Date, id?: string): Promise<string> {
  const at = fireAt ?? nextMidnight();
  return notifee.createTriggerNotification(
    {
      id: id ?? 'chrona-midnight-anchor',
      title: 'Chrona',
      body: '일정 알람 갱신 중…',
      data: { chronaKind: ANCHOR_KIND },
      android: {
        channelId: CHANNELS.timer,
        importance: AndroidImportance.LOW,
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: at.getTime(),
      alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
    }
  );
}

function nextMidnight(): Date {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d;
}

/**
 * 앵커 발화 처리: 재계산(Stage 0에선 로그만) → 자기 자신을 다음 자정으로 재예약 → 표시된 알림 제거.
 * Stage 3에서 recalc 본체가 이 자리에 들어온다.
 */
let anchorRecalc: (() => Promise<unknown>) | null = null;

/** index.js에서 rescheduleAll 주입 (rescheduler ↔ alarm 순환 import 방지) */
export function setAnchorRecalc(fn: () => Promise<unknown>): void {
  anchorRecalc = fn;
}

async function handleAnchorFired(notificationId: string | undefined): Promise<void> {
  console.log('[chrona] midnight anchor fired at', new Date().toISOString());
  if (notificationId) {
    await notifee.cancelNotification(notificationId);
  }
  if (anchorRecalc) {
    await anchorRecalc(); // 재계산이 앵커 재예약까지 수행
  } else {
    await scheduleMidnightAnchor();
  }
}

// ─── 이벤트 / 서비스 등록 ───────────────────────────────

/** 알람 충돌 정책(§3.9): 새 알람 도착 시 이전에 표시 중인 알람을 전부 dismiss */
async function overrideOlderAlarms(newId: string | undefined): Promise<void> {
  const displayed = await notifee.getDisplayedNotifications();
  const olderAlarms = displayed.filter(
    (n) => isAlarmChannel(n.notification.android?.channelId) && n.id !== newId
  );
  if (olderAlarms.length === 0) return;
  for (const n of olderAlarms) {
    if (n.id) await notifee.cancelNotification(n.id);
  }
}

async function handleEvent({ type, detail }: Event): Promise<void> {
  const notification = detail.notification;
  const kind = notification?.data?.chronaKind;

  // 타이머 알림 액션 (앱 안 열고 동작 — stage-6 §1-3)
  if (type === EventType.ACTION_PRESS) {
    const actionId = detail.pressAction?.id;
    if (actionId === 'timer-pause' || actionId === 'timer-resume' || actionId === 'timer-stop') {
      const timerModule = await import('@/native/timer');
      if (actionId === 'timer-pause') await timerModule.pauseTimer();
      if (actionId === 'timer-resume') await timerModule.resumeTimer();
      if (actionId === 'timer-stop') await timerModule.finishTimer(false);
      return;
    }
    // 알람 액션 (stage-13 §1) — 앱이 죽어있는 headless 발화에서도 그대로 동작해야 한다
    if (actionId === 'alarm-dismiss') {
      await dismissAlarm(notification?.id ?? '');
      return;
    }
    if (actionId === 'alarm-snooze') {
      await snoozeAlarm(parseAlarmPayload(notification?.data), notification?.id ?? '');
      return;
    }
  }

  // 알림 본문 탭 → 울리는 중이면 /alarm-ring 으로 (포그라운드 전용. cold start는 getInitialAlarm)
  if (type === EventType.PRESS && isAlarmChannel(notification?.android?.channelId)) {
    if (alarmOpenHandler && notification?.id) {
      alarmOpenHandler(parseAlarmPayload(notification.data), notification.id);
    }
    return;
  }

  if (type === EventType.DELIVERED) {
    if (kind === 'timer-complete') {
      // 완료: 세션 기록 + 상시 알림 정리 (완료 알람 3초 뒤 자동 정리)
      const timerModule = await import('@/native/timer');
      await timerModule.finishTimer(true);
      setTimeout(() => void notifee.cancelNotification('chrona-timer-complete'), 3500);
      return;
    }
    if (kind === ANCHOR_KIND) {
      await handleAnchorFired(notification?.id);
      return;
    }
    if (kind === TIMEOUT_KIND) {
      if (notification?.id) await notifee.cancelNotification(notification.id);
      const target = String(notification?.data?.target ?? '');
      const displayed = await notifee.getDisplayedNotifications();
      if (target && displayed.some((n) => n.id === target)) {
        await dismissAlarm(target);
        await postMissedAlarm(parseAlarmPayload(notification?.data));
      }
      return;
    }
    if (isAlarmChannel(notification?.android?.channelId)) {
      await overrideOlderAlarms(notification?.id);
      const payload = parseAlarmPayload(notification?.data);
      if (notification?.id) {
        await scheduleAlarmTimeout(notification.id, payload);
      }
      // 1회성 순수 알람은 울린 순간 DB에서 끈다 — 다음 재계산이 내일 또 잡지 않게
      const { disableOneShotAlarmIfNeeded } = await import('@/data/oneshot');
      void disableOneShotAlarmIfNeeded(payload.eventId);
      notifyAlarmDelivered(notification?.id, notification?.data);
    }
  }
}

type AlarmOpenHandler = (payload: AlarmPayload, notificationId: string) => void;
let alarmOpenHandler: AlarmOpenHandler | null = null;

/**
 * 알람 알림 탭 → /alarm-ring 이동 콜백 (app/_layout.tsx가 등록).
 * alarm.ts는 expo-router를 import하지 않는다 — headless 컨텍스트에서 라우터가 없기 때문.
 */
export function setAlarmOpenHandler(fn: AlarmOpenHandler | null): void {
  alarmOpenHandler = fn;
}

// /alarm-ring 이 떠 있는지 — 라우터를 모르는 곳(알림 이벤트)에서 중복 push를 막는다.
// usePathname 대신 모듈 플래그를 쓰는 이유: 알림 이벤트는 렌더 밖에서 온다.
let ringScreenOpen = false;

export function setAlarmRingScreenOpen(open: boolean): void {
  ringScreenOpen = open;
}

export function isAlarmRingScreenOpen(): boolean {
  return ringScreenOpen;
}

type AlarmDeliveredListener = (notificationId: string, payload: AlarmPayload) => void;
let alarmDeliveredListener: AlarmDeliveredListener | null = null;

/** 포그라운드에서 알람 도착 시 /alarm-ring 으로 이동시키기 위한 구독 (root layout에서 사용) */
export function subscribeAlarmDelivered(listener: AlarmDeliveredListener): () => void {
  alarmDeliveredListener = listener;
  return () => {
    alarmDeliveredListener = null;
  };
}

function notifyAlarmDelivered(id: string | undefined, data: Record<string, unknown> | undefined) {
  if (alarmDeliveredListener && id) {
    alarmDeliveredListener(id, parseAlarmPayload(data));
  }
}

/**
 * 앱 진입점(index.js)에서 1회 호출. React 밖에서 등록해야
 * 앱이 죽은 상태의 headless 발화(자정 앵커, 부팅 복구)를 받을 수 있다.
 */
export function registerAlarmEngine(): void {
  // 포그라운드 서비스 runner: 알림이 살아있는 동안만 생존.
  // resolve하지 않는 Promise — stopForegroundService()로만 종료된다 (Stage 0 §1-7).
  // 서비스 시작 시 자체 사운드 재생 — One UI가 채널 사운드를 삼키는 간헐 무음 보강.
  notifee.registerForegroundService((notification) => {
    void startAlarmSound(
      typeof notification.data?.soundKey === 'string' ? notification.data.soundKey : 'default'
    );
    return new Promise<void>(() => {});
  });

  notifee.onBackgroundEvent(handleEvent);
  notifee.onForegroundEvent((event) => {
    void handleEvent(event);
  });
}

/**
 * 풀스크린 알람으로 cold start 됐는지 확인.
 * payload는 알림 data에서만 읽는다 — 스토리지/DB 조회 없음 (마스터 §3.5).
 */
export async function getInitialAlarm(): Promise<{
  notificationId: string;
  payload: AlarmPayload;
} | null> {
  const initial = await notifee.getInitialNotification();
  if (!initial) return null;
  const { notification } = initial;
  if (!isAlarmChannel(notification.android?.channelId)) return null;
  return {
    notificationId: notification.id ?? '',
    payload: parseAlarmPayload(notification.data),
  };
}

// ─── 권한 조회 (디버그 화면용, 마스터 §4.1의 1~4 중 API 가능분) ──

export type PermissionSnapshot = {
  notifications: string; // authorized | denied | ...
  exactAlarm: string; // enabled | disabled
  batteryOptimizationEnabled: boolean; // true면 위험 (제한 없음 미적용)
};

export async function getPermissionSnapshot(): Promise<PermissionSnapshot> {
  const settings = await notifee.getNotificationSettings();
  const batteryOptimizationEnabled = await notifee.isBatteryOptimizationEnabled();
  return {
    notifications: authorizationLabel(settings.authorizationStatus),
    exactAlarm: alarmSettingLabel(settings.android.alarm),
    batteryOptimizationEnabled,
  };
}

export async function requestNotificationPermission(): Promise<void> {
  await notifee.requestPermission();
}

export async function openExactAlarmSettings(): Promise<void> {
  await notifee.openAlarmPermissionSettings();
}

export async function openBatterySettings(): Promise<void> {
  await notifee.openBatteryOptimizationSettings();
}

export async function openNotificationSettings(): Promise<void> {
  await notifee.openNotificationSettings();
}

function authorizationLabel(status: number): string {
  // AuthorizationStatus: -1 NOT_DETERMINED / 0 DENIED / 1 AUTHORIZED / 2 PROVISIONAL
  switch (status) {
    case 1:
      return '허용됨';
    case 0:
      return '거부됨';
    default:
      return `미확정(${status})`;
  }
}

function alarmSettingLabel(setting: number): string {
  // AndroidNotificationSetting: 0 NOT_SUPPORTED / 1 ENABLED / 2 DISABLED
  switch (setting) {
    case 1:
      return '허용됨';
    case 2:
      return '거부됨 — 설정 필요';
    default:
      return '해당 없음';
  }
}

// 점진 볼륨 (stage-11): 0 → 목표 볼륨을 30초에 걸쳐. 램프는 네이티브가 수행한다
const RAMP_SECONDS = 30;

/**
 * 알람음 시작 — USAGE_ALARM 네이티브 재생 (§3.10).
 * 무음/진동 모드에서도 울려야 하므로 JS 오디오(USAGE_MEDIA)를 쓰지 않는다.
 */
export async function startAlarmSound(soundKey = 'default'): Promise<void> {
  if (soundKey === 'none') return; // 무음(진동만) — 채널 vibrationPattern이 담당
  const { getLocalSettings } = await import('@/data/local-settings');
  const local = await getLocalSettings();
  await playSound(isSystemSoundUri(soundKey) ? soundKey : soundResource(soundKey), {
    loop: true,
    rampSeconds: local.gradualVolume ? RAMP_SECONDS : 0,
    volumePercent: local.alarmVolumePercent,
  });
}

export async function stopAlarmSound(): Promise<void> {
  await stopSound();
}

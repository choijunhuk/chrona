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
  AndroidCategory,
  AndroidImportance,
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

export const CHANNELS = {
  alarm: 'chrona.alarm',
  reminder: 'chrona.reminder',
  ongoing: 'chrona.ongoing',
  timer: 'chrona.timer',
} as const;

const ONGOING_NOTIFICATION_ID = 'chrona-ongoing';
const ANCHOR_KIND = 'midnight-anchor';
const VIBRATION_PATTERN = [300, 500];

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
}

// ─── 예약 ───────────────────────────────────────────────

/**
 * 알람 모드(②): SET_ALARM_CLOCK + 전체화면 + 끌 때까지 소리.
 * SET_ALARM_CLOCK 이 Doze를 뚫는 유일한 경로 — 다른 타입으로 대체 금지 (Stage 0 §1-5).
 */
export async function scheduleAlarm(payload: AlarmPayload, fireAt: Date): Promise<string> {
  return notifee.createTriggerNotification(
    {
      title: payload.title,
      body: payload.timeLabel,
      data: serializeAlarmPayload(payload),
      android: {
        channelId: CHANNELS.alarm,
        category: AndroidCategory.ALARM,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        fullScreenAction: { id: 'alarm-ring', launchActivity: 'default' },
        pressAction: { id: 'alarm-ring', launchActivity: 'default' },
        loopSound: true,
        sound: 'default',
        ongoing: true,
        autoCancel: false,
        asForegroundService: true,
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
  await notifee.stopForegroundService();
  await notifee.cancelAllNotifications();
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
  await notifee.stopForegroundService();
  if (notificationId) {
    await notifee.cancelNotification(notificationId);
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
  await scheduleAlarm(next, fireAt);
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

// ─── 자정 앵커 (마스터 §3.6) ────────────────────────────

/** 다음 자정(로컬)에 앵커 예약. fireAt 을 넘기면 그 시각으로 (디버그용) */
export async function scheduleMidnightAnchor(fireAt?: Date): Promise<string> {
  const at = fireAt ?? nextMidnight();
  return notifee.createTriggerNotification(
    {
      id: 'chrona-midnight-anchor',
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
async function handleAnchorFired(notificationId: string | undefined): Promise<void> {
  console.log('[chrona] midnight anchor fired at', new Date().toISOString());
  // TODO(Stage 3): 여기서 30건 재계산 실행 (마스터 §3.7)
  await scheduleMidnightAnchor();
  if (notificationId) {
    await notifee.cancelNotification(notificationId);
  }
}

// ─── 이벤트 / 서비스 등록 ───────────────────────────────

/** 알람 충돌 정책(§3.9): 새 알람 도착 시 이전에 표시 중인 알람을 전부 dismiss */
async function overrideOlderAlarms(newId: string | undefined): Promise<void> {
  const displayed = await notifee.getDisplayedNotifications();
  const olderAlarms = displayed.filter(
    (n) => n.notification.android?.channelId === CHANNELS.alarm && n.id !== newId
  );
  if (olderAlarms.length === 0) return;
  for (const n of olderAlarms) {
    if (n.id) await notifee.cancelNotification(n.id);
  }
}

async function handleEvent({ type, detail }: Event): Promise<void> {
  const notification = detail.notification;
  const kind = notification?.data?.chronaKind;

  if (type === EventType.DELIVERED) {
    if (kind === ANCHOR_KIND) {
      await handleAnchorFired(notification?.id);
      return;
    }
    if (notification?.android?.channelId === CHANNELS.alarm) {
      await overrideOlderAlarms(notification?.id);
      notifyAlarmDelivered(notification?.id, notification?.data);
    }
  }
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
  notifee.registerForegroundService(() => new Promise<void>(() => {}));

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
  if (notification.android?.channelId !== CHANNELS.alarm) return null;
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

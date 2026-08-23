/**
 * 디버그 화면 — Stage 0의 유일한 UI (마스터 §10, Stage 0 §1-10).
 * 끝까지 유지한다. 알람 테스트를 실제로 기다릴 수는 없다.
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AlarmPayload } from '@/domain/alarm-payload';
import { formatTimeLabel } from '@/domain/time-label';
import {
  cancelAll,
  cancelOngoing,
  getPermissionSnapshot,
  listScheduled,
  openBatterySettings,
  openExactAlarmSettings,
  requestNotificationPermission,
  scheduleAlarm,
  scheduleMidnightAnchor,
  scheduleReminder,
  showOngoing,
} from '@/native/alarm';
import { clearRemembered, rememberScheduled } from '@/native/alarm-store';

function testPayload(fireAt: Date, title: string): AlarmPayload {
  return {
    eventId: `test-${Date.now()}`,
    occurrenceStart: fireAt.toISOString(),
    title,
    timeLabel: formatTimeLabel(fireAt),
    colorHex: '#6C7BFF',
    snoozeMinutes: 5,
    maxSnooze: 3,
    currentSnoozeCount: 0,
    soundKey: 'default',
  };
}

// 액션 본체는 렌더 밖(모듈 레벨) — react-hooks/purity 대상에서 제외되고, 실제로도 렌더와 무관하다
const actions = {
  testAlarm: async () => {
    const fireAt = new Date(Date.now() + 10_000);
    const payload = testPayload(fireAt, '테스트 알람');
    const id = await scheduleAlarm(payload, fireAt);
    await rememberScheduled(id, fireAt, payload);
    return `② 알람 예약됨 → ${formatTimeLabel(fireAt)} (10초 뒤)`;
  },
  testReminder: async () => {
    const fireAt = new Date(Date.now() + 10_000);
    await scheduleReminder(testPayload(fireAt, '테스트 리마인더'), fireAt);
    return `① 리마인더 예약됨 (10초 뒤)`;
  },
  ongoingOn: async () => {
    await showOngoing('Chrona', '상시 알림 테스트 — 오늘 일정 0건');
    return '③ 상시 알림 표시됨';
  },
  ongoingOff: async () => {
    await cancelOngoing();
    return '③ 상시 알림 해제됨';
  },
  dump: async () => {
    const list = await listScheduled();
    if (list.length === 0) return '예약된 알람 없음';
    return list
      .map(
        (a) =>
          `• ${a.isAnchor ? '[앵커] ' : ''}${a.title} @ ${
            a.fireAt ? a.fireAt.toLocaleString() : '?'
          }`
      )
      .join('\n');
  },
  perms: async () => {
    const s = await getPermissionSnapshot();
    return [
      `알림 권한: ${s.notifications}`,
      `알람 및 리마인더(정확한 알람): ${s.exactAlarm}`,
      `배터리 최적화: ${s.batteryOptimizationEnabled ? '적용 중 ⚠ (제한 없음 필요)' : '제한 없음 ✓'}`,
      `전체화면 알림: API 확인 불가 — 설정 > 애플리케이션 > Chrona 에서 수동 확인`,
    ].join('\n');
  },
  wipe: async () => {
    await cancelAll();
    await clearRemembered();
    return '모든 알람·알림 취소됨';
  },
  anchor: async () => {
    await scheduleMidnightAnchor(new Date(Date.now() + 60_000));
    return '자정 앵커 → 1분 뒤로 시뮬 예약됨 (발화 로그 확인)';
  },
  requestPermission: async () => {
    await requestNotificationPermission();
    return '알림 권한 요청됨';
  },
  openExactAlarm: async () => {
    await openExactAlarmSettings();
    return '정확한 알람 설정 열림';
  },
  openBattery: async () => {
    await openBatterySettings();
    return '배터리 설정 열림';
  },
} as const;

export default function Debug() {
  const [log, setLog] = useState<string[]>([]);
  const append = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 40));
  }, []);

  const run = useCallback(
    (fn: () => Promise<string>) => () => {
      fn()
        .then((msg) => append(msg))
        .catch((e) => append(`실패: ${String(e)}`));
    },
    [append]
  );

  const testAlarm = run(actions.testAlarm);
  const testReminder = run(actions.testReminder);
  const ongoingOn = run(actions.ongoingOn);
  const ongoingOff = run(actions.ongoingOff);
  const dump = run(actions.dump);
  const perms = run(actions.perms);
  const wipe = run(actions.wipe);
  const anchor = run(actions.anchor);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Chrona /debug</Text>

      <Btn label="10초 뒤 알람 테스트 (② 알람 모드)" onPress={testAlarm} accent />
      <Btn label="10초 뒤 리마인더 테스트 (① 조용한 알림)" onPress={testReminder} />
      <View style={styles.row}>
        <Btn label="상시 알림 표시 (③)" onPress={ongoingOn} half />
        <Btn label="상시 알림 해제" onPress={ongoingOff} half />
      </View>
      <Btn label="예약된 알람 목록 덤프" onPress={dump} />
      <Btn label="권한 상태 전체 조회" onPress={perms} />
      <Btn label="모든 알람 취소" onPress={wipe} />
      <Btn label="자정 앵커 즉시 예약 (1분 뒤로 시뮬)" onPress={anchor} />

      <Text style={styles.subheading}>권한 설정 바로가기</Text>
      <View style={styles.row}>
        <Btn label="알림 권한 요청" onPress={run(actions.requestPermission)} half />
        <Btn label="정확한 알람 설정" onPress={run(actions.openExactAlarm)} half />
      </View>
      <Btn label="배터리 최적화 설정 열기" onPress={run(actions.openBattery)} />

      <Text style={styles.subheading}>로그</Text>
      {log.map((line, i) => (
        <Text key={i} style={styles.log}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

function Btn({
  label,
  onPress,
  accent,
  half,
}: {
  label: string;
  onPress: () => void;
  accent?: boolean;
  half?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        accent && styles.btnAccent,
        half && styles.btnHalf,
        pressed && styles.btnPressed,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E0F13' },
  content: { padding: 16, paddingTop: 64, gap: 10 },
  heading: { color: '#EDEFF5', fontSize: 24, fontWeight: '700', marginBottom: 8 },
  subheading: { color: '#9BA1B0', fontSize: 13, marginTop: 16 },
  row: { flexDirection: 'row', gap: 10 },
  btn: {
    backgroundColor: '#17191F',
    borderColor: '#282C36',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  btnAccent: { backgroundColor: '#2A3070', borderColor: '#6C7BFF' },
  btnHalf: { flex: 1 },
  btnPressed: { opacity: 0.6 },
  btnText: { color: '#EDEFF5', fontSize: 15 },
  log: { color: '#9BA1B0', fontSize: 12, fontFamily: 'monospace' },
});

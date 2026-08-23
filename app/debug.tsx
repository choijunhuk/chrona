/**
 * 디버그 화면 — Stage 0의 유일한 UI (마스터 §10, Stage 0 §1-10).
 * 끝까지 유지한다. 알람 테스트를 실제로 기다릴 수는 없다.
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { signOut } from '@/data/auth';
import { useEvents } from '@/data/hooks/events';
import { useCategories, useSettings } from '@/data/hooks/settings';
import type { EventDraft, EventRow } from '@/data/mappers';
import { toEventInsert } from '@/data/mappers';
import { assertOnline, useNetStore } from '@/data/net';
import { queryClient } from '@/data/query';
import { supabase } from '@/data/supabase';
import type { AlarmPayload } from '@/domain/alarm-payload';
import { asDateOnly, formatTimeLabel, fromDateOnly, toDateOnly } from '@/domain/time';
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
async function scheduleTestAlarm(afterMs: number, label: string) {
  const fireAt = new Date(Date.now() + afterMs);
  const payload = testPayload(fireAt, '테스트 알람');
  const id = await scheduleAlarm(payload, fireAt);
  await rememberScheduled(id, fireAt, payload);
  return `② 알람 예약됨 → ${formatTimeLabel(fireAt)} (${label} 뒤)`;
}

const actions = {
  testAlarm: () => scheduleTestAlarm(10_000, '10초'),
  testAlarm3m: () => scheduleTestAlarm(3 * 60_000, '3분'), // 재부팅 복구 검증용
  testAlarm65m: () => scheduleTestAlarm(65 * 60_000, '65분'), // Doze 관통 검증용
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

  // ── Stage 1: 데이터 계층 검증 ──────────────────────────
  seedTestEvents: async () => {
    assertOnline();
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return '로그인 필요';
    const userId = sessionData.session.user.id;
    const base = new Date();
    const drafts: EventDraft[] = [];
    for (let i = 0; i < 7; i++) {
      const start = new Date(base.getTime() + (i + 1) * 3600_000);
      drafts.push({
        kind: 'schedule',
        title: `테스트 일정 ${i + 1}`,
        memo: null,
        categoryId: null,
        color: null,
        allDay: false,
        startsAt: start,
        endsAt: new Date(start.getTime() + 3600_000),
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
      });
    }
    // 종일 2건 (§7.2 검증용) + task 1건
    const today = toDateOnly(base, 'Asia/Seoul');
    drafts.push({
      ...drafts[0],
      title: '종일 테스트 A',
      allDay: true,
      startsAt: null,
      endsAt: null,
      startDate: today,
      endDate: today,
    });
    drafts.push({
      ...drafts[0],
      title: '종일 테스트 B',
      allDay: true,
      startsAt: null,
      endsAt: null,
      startDate: asDateOnly('2026-12-31'),
      endDate: asDateOnly('2026-12-31'),
    });
    drafts.push({
      ...drafts[0],
      kind: 'task',
      title: '과제 테스트',
      startsAt: null,
      endsAt: null,
      dueAt: new Date(base.getTime() + 72 * 3600_000),
    });
    const { error } = await supabase
      .from('events')
      .insert(drafts.map((d) => toEventInsert(d, userId)));
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: ['events'] });
    return '테스트 일정 10건 생성됨 (시각 7 / 종일 2 / 과제 1)';
  },

  dumpEvents: async () => {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const rows = data as EventRow[];
    const alive = rows.filter((r) => !r.deleted_at);
    const deleted = rows.filter((r) => r.deleted_at);
    const lines = alive
      .slice(0, 12)
      .map(
        (r) =>
          `• [${r.kind}] ${r.title} ${r.all_day ? `(종일 ${r.start_date})` : (r.starts_at ?? r.due_at ?? '')}`
      );
    return [`events: 활성 ${alive.length} / 삭제됨 ${deleted.length}`, ...lines].join('\n');
  },

  softDeleteLatest: async () => {
    assertOnline();
    const { data, error } = await supabase
      .from('events')
      .select('id,title')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data.length) return '삭제할 일정 없음';
    const { error: delError } = await supabase
      .from('events')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', data[0].id);
    if (delError) throw delError;
    await queryClient.invalidateQueries({ queryKey: ['events'] });
    return `soft delete: "${data[0].title}" (deleted_at 세팅, 물리 삭제 아님)`;
  },

  cacheStatus: async () => {
    const online = useNetStore.getState().isOnline;
    const queries = queryClient.getQueryCache().getAll();
    return [
      `온라인: ${online ? 'O' : 'X (오프라인)'}`,
      `캐시된 쿼리: ${queries.length}개`,
      ...queries.slice(0, 8).map((q) => `• ${JSON.stringify(q.queryKey)} [${q.state.status}]`),
    ].join('\n');
  },

  timezoneCheck: async () => {
    // §7.2 검증: 종일 일정 DateOnly는 어느 시간대에서도 같은 날짜
    const day = asDateOnly('2026-08-24');
    const zones = ['Asia/Seoul', 'UTC', 'America/New_York'];
    const lines = zones.map((tz) => {
      const roundTrip = toDateOnly(fromDateOnly(day, tz), tz);
      return `${tz}: ${day} → ${roundTrip} ${roundTrip === day ? '✓' : '✗ 하루 밀림!'}`;
    });
    const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return [`기기 시간대: ${deviceTz}`, ...lines].join('\n');
  },

  seedCheck: async () => {
    const [cat, period, settings] = await Promise.all([
      supabase.from('categories').select('name', { count: 'exact', head: false }),
      supabase.from('period_presets').select('period_no', { count: 'exact', head: true }),
      supabase.from('app_settings').select('user_id').maybeSingle(),
    ]);
    if (cat.error || period.error || settings.error)
      throw cat.error ?? period.error ?? settings.error;
    return [
      `카테고리: ${cat.data?.length ?? 0}개 (${(cat.data ?? []).map((c) => c.name).join(', ')})`,
      `교시 프리셋: ${period.count ?? 0}개`,
      `app_settings: ${settings.data ? '있음' : '없음'}`,
    ].join('\n');
  },

  logout: async () => {
    await signOut();
    return '로그아웃됨';
  },
} as const;

// 훅 마운트 → TanStack 캐시 적재 → AsyncStorage persist → 오프라인 읽기 검증 가능 (stage-1 검증 6)
const EVENT_RANGE = {
  from: new Date(Date.now() - 7 * 86400_000),
  to: new Date(Date.now() + 30 * 86400_000),
  tz: 'Asia/Seoul',
};

function DataStatus() {
  const events = useEvents(EVENT_RANGE);
  const categories = useCategories();
  const settings = useSettings();
  // 캐시 데이터가 있으면 상태보다 데이터 우선 표시 (오프라인 refetch 실패 시에도 캐시는 유효)
  const label = (s: { status: string }, n: number | undefined) =>
    n !== undefined ? `${n}건${s.status === 'error' ? '(캐시)' : ''}` : s.status;
  return (
    <Text style={styles.dataStatus}>
      TanStack: 일정 {label(events, events.data?.length)} · 카테고리{' '}
      {label(categories, categories.data?.length)} · 설정 {settings.status}
      {events.isFetching || categories.isFetching ? ' (fetching…)' : ''}
    </Text>
  );
}

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
  const testAlarm3m = run(actions.testAlarm3m);
  const testAlarm65m = run(actions.testAlarm65m);
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
      <DataStatus />

      <Btn label="10초 뒤 알람 테스트 (② 알람 모드)" onPress={testAlarm} accent />
      <View style={styles.row}>
        <Btn label="3분 뒤 알람 (재부팅 검증)" onPress={testAlarm3m} half />
        <Btn label="65분 뒤 알람 (Doze 검증)" onPress={testAlarm65m} half />
      </View>
      <Btn label="10초 뒤 리마인더 테스트 (① 조용한 알림)" onPress={testReminder} />
      <View style={styles.row}>
        <Btn label="상시 알림 표시 (③)" onPress={ongoingOn} half />
        <Btn label="상시 알림 해제" onPress={ongoingOff} half />
      </View>
      <Btn label="예약된 알람 목록 덤프" onPress={dump} />
      <Btn label="권한 상태 전체 조회" onPress={perms} />
      <Btn label="모든 알람 취소" onPress={wipe} />
      <Btn label="자정 앵커 즉시 예약 (1분 뒤로 시뮬)" onPress={anchor} />

      <Text style={styles.subheading}>Stage 1 — 데이터 계층</Text>
      <Btn label="테스트 일정 10건 생성" onPress={run(actions.seedTestEvents)} accent />
      <View style={styles.row}>
        <Btn label="전체 events 덤프" onPress={run(actions.dumpEvents)} half />
        <Btn label="최근 1건 soft delete" onPress={run(actions.softDeleteLatest)} half />
      </View>
      <View style={styles.row}>
        <Btn label="캐시/온라인 상태" onPress={run(actions.cacheStatus)} half />
        <Btn label="시각 변환 테스트 (3TZ)" onPress={run(actions.timezoneCheck)} half />
      </View>
      <View style={styles.row}>
        <Btn label="시딩 확인" onPress={run(actions.seedCheck)} half />
        <Btn label="로그아웃" onPress={run(actions.logout)} half />
      </View>

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
  dataStatus: { color: '#5BD8A6', fontSize: 13 },
});

/* eslint react-hooks/refs: "off" -- PanResponder ref는 렌더에서 handlers만 전개. 값 접근 아님 */
/**
 * 시간표 탭 (stage-5 §1-7). 세로축은 교시(period_presets), 가로 월~금.
 * 빈 칸 드래그 → 블록 생성. 블록 탭 → 편집(일정 편집기 재사용).
 */
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRemindersForEvents, useSaveReminders } from '@/data/hooks/reminders';
import {
  useCopySemesterTimetable,
  useCreateSemester,
  useCreateTimetableBlock,
  usePeriodPresets,
  useSemesters,
  useSetActiveSemester,
  useTimetableEvents,
} from '@/data/hooks/timetable';
import type { ChronaEvent, Reminder, Semester } from '@/domain/types';
import { toDateOnly } from '@/domain/time';
import { Button } from '@/ui/components/button';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { palette, radius, spacing, type ThemeColors } from '@/ui/tokens';

const TZ = 'Asia/Seoul';
const DAYS = ['월', '화', '수', '목', '금'];
const DAY_TO_WEEKDAY = [1, 2, 3, 4, 5]; // col → JS weekday

const timeToMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * 시간표 블록의 "이번 주" 회차 (stage-15).
 * 시간표 이벤트는 매주 반복이라 편집기에 base starts_at을 넘기면 "이 일정만"이 학기 첫 주를
 * 가리킨다. 오늘이 속한 주(월 시작)에서 그 열의 요일 날짜 + 원래 시각으로 맞춘다.
 */
function occurrenceInCurrentWeek(startsAt: Date, weekday: number): Date {
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7; // 월=0 … 일=6
  const occ = new Date(now);
  occ.setDate(now.getDate() - mondayOffset + (weekday - 1));
  occ.setHours(
    startsAt.getHours(),
    startsAt.getMinutes(),
    startsAt.getSeconds(),
    startsAt.getMilliseconds()
  );
  return occ;
}

type Block = {
  event: ChronaEvent;
  col: number;
  rowStart: number;
  rowEnd: number; // inclusive
};

export function TimetableScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: semesters } = useSemesters();
  const active = (semesters ?? []).find((s) => s.isActive) ?? null;
  const { data: periods } = usePeriodPresets();
  const { data: events } = useTimetableEvents(active?.id ?? null);
  const createBlock = useCreateTimetableBlock();
  const saveReminders = useSaveReminders();

  const [drag, setDrag] = useState<{ col: number; rowStart: number; rowEnd: number } | null>(null);
  const [pendingCell, setPendingCell] = useState<{ col: number; rowStart: number; rowEnd: number } | null>(null);
  const [title, setTitle] = useState('');
  const [room, setRoom] = useState('');

  const rows = useMemo(() => periods ?? [], [periods]);

  // 블록 배치: 이벤트 시각 ↔ 교시 겹침
  const blocks = useMemo<Block[]>(() => {
    if (!rows.length) return [];
    const out: Block[] = [];
    for (const e of events ?? []) {
      if (!e.startsAt || !e.endsAt) continue;
      const weekday = e.startsAt.getDay();
      const col = DAY_TO_WEEKDAY.indexOf(weekday);
      if (col < 0) continue;
      const sMin = e.startsAt.getHours() * 60 + e.startsAt.getMinutes();
      const eMin = e.endsAt.getHours() * 60 + e.endsAt.getMinutes();
      let rowStart = -1;
      let rowEnd = -1;
      rows.forEach((p, i) => {
        if (timeToMin(p.startTime) < eMin && sMin < timeToMin(p.endTime)) {
          if (rowStart < 0) rowStart = i;
          rowEnd = i;
        }
      });
      if (rowStart >= 0) out.push({ event: e, col, rowStart, rowEnd });
    }
    return out;
  }, [events, rows]);

  // 과목 색: 팔레트에서 중복 최소 배정
  const nextColor = useMemo(() => {
    const used = new Set((events ?? []).map((e) => e.color));
    return palette.find((p) => !used.has(p)) ?? palette[(events ?? []).length % palette.length];
  }, [events]);

  // ── 드래그 생성 ──────────────────────────────────────
  const gridLayout = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const dragRef = useRef<typeof drag>(null);
  const onGridLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    gridLayout.current = { ...gridLayout.current, w: width, h: height };
  };

  const cellFromXY = (x: number, y: number) => {
    const { w, h } = gridLayout.current;
    if (!w || !h || !rows.length) return null;
    const col = Math.floor((x / w) * DAYS.length);
    const row = Math.floor((y / h) * rows.length);
    if (col < 0 || col >= DAYS.length || row < 0 || row >= rows.length) return null;
    return { col, row };
  };

  const isOccupied = (col: number, row: number) =>
    blocks.some((b) => b.col === col && row >= b.rowStart && row <= b.rowEnd);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const c = cellFromXY(e.nativeEvent.locationX, e.nativeEvent.locationY);
        if (!c || isOccupied(c.col, c.row)) return;
        const d = { col: c.col, rowStart: c.row, rowEnd: c.row };
        dragRef.current = d;
        setDrag(d);
        haptics.selection();
      },
      onPanResponderMove: (e) => {
        const cur = dragRef.current;
        if (!cur) return;
        const c = cellFromXY(e.nativeEvent.locationX, e.nativeEvent.locationY);
        if (!c) return;
        const rowEnd = Math.max(cur.rowStart, c.row);
        if (rowEnd !== cur.rowEnd) {
          const d = { ...cur, rowEnd };
          dragRef.current = d;
          setDrag(d);
        }
      },
      onPanResponderRelease: () => {
        const cur = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (cur) {
          // 점유 칸과 겹치면 축소
          let end = cur.rowEnd;
          for (let r = cur.rowStart; r <= cur.rowEnd; r++) {
            if (isOccupied(cur.col, r)) {
              end = r - 1;
              break;
            }
          }
          if (end >= cur.rowStart) setPendingCell({ ...cur, rowEnd: end });
        }
      },
      onPanResponderTerminate: () => {
        dragRef.current = null;
        setDrag(null);
      },
    })
  ).current;

  const confirmCreate = async () => {
    if (!active || !pendingCell || !rows.length) return;
    try {
      await createBlock.mutateAsync({
        semester: active,
        weekday: DAY_TO_WEEKDAY[pendingCell.col],
        startTime: rows[pendingCell.rowStart].startTime,
        endTime: rows[pendingCell.rowEnd].endTime,
        title: title.trim() || '새 과목',
        color: nextColor,
        location: room.trim() || null,
        tz: TZ,
      });
      haptics.success();
    } finally {
      setPendingCell(null);
      setTitle('');
      setRoom('');
    }
  };

  // 알림 일괄 (stage-5 §1-7): 전 과목 10분 전 notify on/off.
  // 스위치 상태는 실제 reminders에서 도출한다 — 로컬 boolean은 앱을 껐다 켜면 거짓말을 한다.
  const eventIds = useMemo(() => (events ?? []).map((e) => e.id), [events]);
  const { data: allReminders } = useRemindersForEvents(eventIds);
  const isBulkReminder = (r: Reminder) => r.offsetMinutes === 10 && r.mode === 'notify';
  const toDraft = (r: Reminder) => ({
    offsetMinutes: r.offsetMinutes,
    mode: r.mode,
    soundKey: r.soundKey,
    vibrate: r.vibrate,
    enabled: r.enabled,
  });

  const bulkOn = useMemo(() => {
    const evs = events ?? [];
    if (!evs.length || !allReminders) return false;
    return evs.every((e) => allReminders.some((r) => r.eventId === e.id && isBulkReminder(r)));
  }, [events, allReminders]);
  const [pendingBulk, setPendingBulk] = useState<boolean | null>(null);

  const toggleBulk = async (on: boolean) => {
    const evs = events ?? [];
    if (!evs.length) return;
    setPendingBulk(on);
    haptics.selection();
    try {
      // 다른 알림은 건드리지 않는다 — 10분 전 notify 하나만 더하거나 뺀다
      const jobs = [];
      for (const e of evs) {
        const mine = (allReminders ?? []).filter((r) => r.eventId === e.id);
        const has = mine.some(isBulkReminder);
        if (on === has) continue;
        const drafts = on
          ? [
              ...mine.map(toDraft),
              { offsetMinutes: 10, mode: 'notify' as const, soundKey: 'default', vibrate: true, enabled: true },
            ]
          : mine.filter((r) => !isBulkReminder(r)).map(toDraft);
        jobs.push(saveReminders.mutateAsync({ eventId: e.id, drafts }));
      }
      await Promise.all(jobs);
    } catch (err) {
      ToastAndroid.show(`알림 변경 실패: ${String(err)}`, ToastAndroid.LONG);
    } finally {
      setPendingBulk(null);
    }
  };

  if (!active) {
    return <SemesterSetup />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <SemesterPicker semesters={semesters ?? []} active={active} />
        <View style={styles.bulkRow}>
          <AppText variant="micro" color="textSub">
            수업 10분 전 알림
          </AppText>
          <Switch
            value={pendingBulk ?? bulkOn}
            onValueChange={toggleBulk}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.white}
          />
        </View>
      </View>

      <View style={styles.gridWrap}>
        {/* 요일 헤더 */}
        <View style={styles.dayHeader}>
          <View style={styles.periodCol} />
          {DAYS.map((d) => (
            <AppText key={d} variant="micro" color="textSub" style={styles.dayLabel}>
              {d}
            </AppText>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.gridScroll}>
          <View style={styles.gridRow}>
            {/* 교시 축 */}
            <View style={styles.periodCol}>
              {rows.map((p) => (
                <View key={p.id} style={styles.periodCell}>
                  <AppText variant="micro" color="textDim" nums>
                    {p.periodNo}
                  </AppText>
                  <AppText variant="micro" color="textDim" nums style={styles.periodTime}>
                    {p.startTime}
                  </AppText>
                </View>
              ))}
            </View>

            {/* 격자 + 블록 */}
            <View style={styles.grid} onLayout={onGridLayout} {...pan.panHandlers}>
              {rows.map((p, ri) => (
                <View key={p.id} style={styles.rowLine}>
                  {DAYS.map((_, ci) => (
                    <View key={ci} style={styles.cell} />
                  ))}
                </View>
              ))}

              {/* 드래그 하이라이트 */}
              {drag && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.dragHighlight,
                    {
                      left: `${(drag.col / DAYS.length) * 100}%`,
                      width: `${100 / DAYS.length}%`,
                      top: `${(drag.rowStart / rows.length) * 100}%`,
                      height: `${((drag.rowEnd - drag.rowStart + 1) / rows.length) * 100}%`,
                      borderColor: colors.accent,
                      backgroundColor: `${colors.accent}22`,
                    },
                  ]}
                />
              )}

              {blocks.map((b) => (
                <Pressable
                  key={b.event.id}
                  style={[
                    styles.block,
                    {
                      left: `${(b.col / DAYS.length) * 100}%`,
                      width: `${100 / DAYS.length}%`,
                      top: `${(b.rowStart / rows.length) * 100}%`,
                      height: `${((b.rowEnd - b.rowStart + 1) / rows.length) * 100}%`,
                      backgroundColor: `${b.event.color ?? palette[0]}33`,
                      borderLeftColor: b.event.color ?? palette[0],
                    },
                  ]}
                  onPress={() =>
                    router.push({
                      pathname: '/event/[id]',
                      params: b.event.startsAt
                        ? {
                            id: b.event.id,
                            occ: occurrenceInCurrentWeek(
                              b.event.startsAt,
                              DAY_TO_WEEKDAY[b.col]
                            ).toISOString(),
                          }
                        : { id: b.event.id },
                    })
                  }
                >
                  <AppText variant="micro" numberOfLines={2} style={styles.blockTitle}>
                    {b.event.title}
                  </AppText>
                  {b.event.location && (
                    <AppText variant="micro" color="textSub" numberOfLines={1}>
                      {b.event.location}
                    </AppText>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* 블록 생성 모달 */}
      <Modal visible={!!pendingCell} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <AppText variant="title">새 과목</AppText>
            {pendingCell && rows.length > 0 && (
              <AppText variant="caption" color="textSub">
                {DAYS[pendingCell.col]} {rows[pendingCell.rowStart].periodNo}~
                {rows[pendingCell.rowEnd].periodNo}교시 ·{' '}
                {rows[pendingCell.rowStart].startTime}~{rows[pendingCell.rowEnd].endTime}
              </AppText>
            )}
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="과목명"
              placeholderTextColor={colors.textDim}
              autoFocus
            />
            <TextInput
              style={styles.input}
              value={room}
              onChangeText={setRoom}
              placeholder="강의실 (선택)"
              placeholderTextColor={colors.textDim}
            />
            <View style={styles.modalActions}>
              <Button label="취소" variant="ghost" onPress={() => setPendingCell(null)} style={styles.modalBtn} />
              <Button label="만들기" onPress={confirmCreate} loading={createBlock.isPending} style={styles.modalBtn} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** 학기 없을 때 첫 학기 만들기 */
function SemesterSetup() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const createSemester = useCreateSemester();
  const [name, setName] = useState('2026-2학기');

  const create = () => {
    // 기본값: 오늘 기준 9/1~12/20 (편집은 추후 학기 관리에서)
    const year = new Date().getFullYear();
    void createSemester
      .mutateAsync({
        name: name.trim() || `${year}-학기`,
        startDate: toDateOnly(new Date(year, 8, 1, 12), TZ),
        endDate: toDateOnly(new Date(year, 11, 20, 12), TZ),
      })
      .then(() => haptics.success());
  };

  return (
    <View style={[styles.container, styles.setup, { paddingTop: insets.top + spacing.xl }]}>
      <AppText variant="display">시간표</AppText>
      <AppText color="textSub">학기를 먼저 만들어야 해요 (9/1 ~ 12/20 기본)</AppText>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="학기 이름"
        placeholderTextColor={colors.textDim}
      />
      <Button label="학기 만들기" onPress={create} loading={createSemester.isPending} />
    </View>
  );
}

function SemesterPicker({ semesters, active }: { semesters: Semester[]; active: Semester }) {
  const setActive = useSetActiveSemester();
  const copyTimetable = useCopySemesterTimetable();
  const createSemester = useCreateSemester();

  const openPicker = () => {
    Alert.alert('학기', active.name, [
      ...semesters
        .filter((s) => s.id !== active.id)
        .slice(0, 2)
        .map((s) => ({ text: `${s.name}로 전환`, onPress: () => setActive.mutate(s.id) })),
      {
        text: '새 학기 (시간표 복사)',
        onPress: () => {
          const year = new Date().getFullYear() + (new Date().getMonth() >= 8 ? 1 : 0);
          const isSpring = new Date().getMonth() >= 8;
          const name = `${year}-${isSpring ? 1 : 2}학기`;
          void createSemester
            .mutateAsync({
              name,
              startDate: (isSpring ? `${year}-03-02` : `${year}-09-01`) as never,
              endDate: (isSpring ? `${year}-06-21` : `${year}-12-20`) as never,
            })
            .then((created) =>
              copyTimetable.mutateAsync({
                from: active,
                to: {
                  id: created.id,
                  name: created.name,
                  startDate: created.start_date as never,
                  endDate: created.end_date as never,
                  isActive: true,
                },
                tz: TZ,
              })
            );
        },
      },
      { text: '닫기', style: 'cancel' },
    ]);
  };

  return (
    <Pressable onPress={openPicker}>
      <AppText variant="title">{active.name} ▾</AppText>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
    setup: { gap: spacing.lg },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    bulkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    gridWrap: { flex: 1 },
    dayHeader: { flexDirection: 'row', paddingBottom: spacing.xs },
    dayLabel: { flex: 1, textAlign: 'center' },
    gridScroll: { paddingBottom: spacing.x40 },
    gridRow: { flexDirection: 'row' },
    periodCol: { width: 40 },
    periodCell: {
      height: 64,
      alignItems: 'center',
      justifyContent: 'center',
    },
    periodTime: { fontSize: 8 },
    grid: { flex: 1, position: 'relative' },
    rowLine: { flexDirection: 'row', height: 64 },
    cell: {
      flex: 1,
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
    },
    dragHighlight: {
      position: 'absolute',
      borderWidth: 1.5,
      borderRadius: radius.sm,
    },
    block: {
      position: 'absolute',
      borderRadius: radius.sm,
      borderLeftWidth: 3,
      padding: 4,
    },
    blockTitle: { fontWeight: '600' },
    modalBackdrop: {
      flex: 1,
      backgroundColor: `${colors.black}88`,
      justifyContent: 'center',
      padding: spacing.xl,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      gap: spacing.lg,
    },
    input: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      color: colors.text,
      fontSize: 15,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    modalActions: { flexDirection: 'row', gap: spacing.md },
    modalBtn: { flex: 1 },
  });

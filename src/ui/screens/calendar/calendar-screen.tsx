/* eslint react-hooks/immutability: "off", react-hooks/refs: "off" -- Reanimated shared value 쓰기는 전부 worklet/effect. React 상태 아님 */
/**
 * 캘린더 화면 (stage-2 §1-4·1-5).
 * - progress(0=월, 1=주) 하나로 접기 전환 전부 구동 — 전 과정 UI 스레드
 * - 단일 Pan + 축 잠금: 시작 방향으로 세로(접기)/가로(페이징) 결정. Race 조합의 모호성 제거
 * - 드래그 중 runOnJS 0회. 스냅 완료 콜백에서 상태 동기화 1회만
 */
import { useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEvents } from '@/data/hooks/events';
import { usePermissionStore } from '@/native/permissions';
import { useCategories } from '@/data/hooks/settings';
import {
  WEEKDAY_LABELS,
  addDaysOnly,
  addMonths,
  monthGrid,
  monthOf,
  weekIndexOf,
  weekOf,
  type MonthGridCell,
} from '@/domain/calendar';
import { fromDateOnly, toDateOnly, todayDateOnly, type DateOnly } from '@/domain/time';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { spacing, springSnap, type ThemeColors } from '@/ui/tokens';

import { DaySheet } from './day-sheet';
import { MonthPage, MAX_LANES, type OverflowMap, type WeekBar } from './month-page';

const TZ = 'Asia/Seoul';

export function CalendarScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // 그리드가 화면을 채우도록 셀 높이를 동적으로 (하단 시트 peek·탭바·헤더 제외)
  const cellHeight = Math.min(78, Math.max(56, Math.floor((height - 340) / 6)));
  const collapseDistance = cellHeight * 5;
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const today = todayDateOnly(TZ);

  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [center, setCenter] = useState(() => monthOf(today));
  const [selectedDate, setSelectedDate] = useState<DateOnly>(today);

  const centerGrid = useMemo(() => monthGrid(center.year, center.month), [center]);
  const prevMonth = addMonths(center.year, center.month, -1);
  const nextMonth = addMonths(center.year, center.month, 1);
  const prevGrid = useMemo(
    () => monthGrid(prevMonth.year, prevMonth.month),
    [prevMonth.year, prevMonth.month]
  );
  const nextGrid = useMemo(
    () => monthGrid(nextMonth.year, nextMonth.month),
    [nextMonth.year, nextMonth.month]
  );

  const prevWeekGrid = useMemo<MonthGridCell[][]>(
    () => [weekOf(addDaysOnly(selectedDate, -7)).map((d) => ({ date: d, inMonth: true }))],
    [selectedDate]
  );
  const nextWeekGrid = useMemo<MonthGridCell[][]>(
    () => [weekOf(addDaysOnly(selectedDate, 7)).map((d) => ({ date: d, inMonth: true }))],
    [selectedDate]
  );

  // ── 이벤트 → 날짜별 색상 점 ──────────────────────────
  const range = useMemo(() => {
    const from = fromDateOnly(prevGrid[0][0].date, TZ);
    const to = new Date(fromDateOnly(nextGrid[5][6].date, TZ).getTime() + 86400_000);
    return { from, to, tz: TZ };
  }, [prevGrid, nextGrid]);
  const { data: events, isPending } = useEvents(range);
  const { data: categories } = useCategories();

  // 모든 일정을 제목 실린 필로 — 단일/연속 동일 시스템 (디자인 시그니처)
  const spans = useMemo(() => {
    const catColor = new Map((categories ?? []).map((c) => [c.id, c.color]));
    const list: { from: DateOnly; to: DateOnly; color: string; title: string }[] = [];
    for (const e of events ?? []) {
      const color =
        e.color ?? (e.categoryId ? (catColor.get(e.categoryId) ?? colors.accent) : colors.accent);
      let from: DateOnly | null = null;
      let to: DateOnly | null = null;
      if (e.allDay && e.startDate) {
        from = e.startDate;
        to = e.endDate ?? e.startDate;
      } else if (e.startsAt) {
        from = toDateOnly(e.startsAt, TZ);
        to = toDateOnly(e.endsAt ?? e.startsAt, TZ);
      } else if (e.dueAt) {
        from = to = toDateOnly(e.dueAt, TZ);
      }
      if (!from || !to) continue;
      list.push({ from, to, color, title: e.title });
    }
    // 연속 일정 먼저(레인 안정), 그다음 시작일 순
    list.sort((a, b) => (a.from === b.from ? (a.to < b.to ? 1 : -1) : a.from < b.from ? -1 : 1));
    return list;
  }, [events, categories, colors.accent]);

  const layoutWeeks = (grid: MonthGridCell[][]): { bars: WeekBar[][]; overflow: OverflowMap } => {
    const overflow: OverflowMap = {};
    const bars = grid.map((week) => {
      const rowBars: WeekBar[] = [];
      const weekStart = week[0].date;
      const weekEnd = week[6].date;
      const segs = spans
        .filter((sp) => sp.from <= weekEnd && sp.to >= weekStart)
        .map((sp) => {
          const startCol = Math.max(0, week.findIndex((c) => c.date >= sp.from));
          const endIdx = [...week].reverse().findIndex((c) => c.date <= sp.to);
          return {
            startCol,
            endCol: 6 - Math.max(0, endIdx),
            color: sp.color,
            // 제목은 세그먼트 시작에서만 (이어지는 주는 바만)
            title: sp.from >= weekStart ? sp.title : sp.title,
          };
        })
        .sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol);
      for (const c of segs) {
        let lane = 0;
        while (
          lane < MAX_LANES &&
          rowBars.some((b) => b.lane === lane && c.startCol <= b.endCol && b.startCol <= c.endCol)
        ) {
          lane++;
        }
        if (lane >= MAX_LANES) {
          for (let col = c.startCol; col <= c.endCol; col++) {
            const d = week[col].date;
            overflow[d] = (overflow[d] ?? 0) + 1;
          }
          continue;
        }
        rowBars.push({ ...c, lane });
      }
      return rowBars;
    });
    return { bars, overflow };
  };

  const centerLayout = useMemo(() => layoutWeeks(centerGrid), [centerGrid, spans]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevLayout = useMemo(
    () => layoutWeeks(mode === 'week' ? prevWeekGrid : prevGrid),
    [prevWeekGrid, prevGrid, spans, mode] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nextLayout = useMemo(
    () => layoutWeeks(mode === 'week' ? nextWeekGrid : nextGrid),
    [nextWeekGrid, nextGrid, spans, mode] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── 애니메이션 상태 ──────────────────────────────────
  const progress = useSharedValue(0);
  const startProgress = useSharedValue(0);
  const selectedWeekIndex = useSharedValue(0);
  const sideWeekIndex = useSharedValue(0);
  const dragX = useSharedValue(0);
  const axis = useSharedValue<0 | 1 | 2>(0); // 0 미정 / 1 세로(접기) / 2 가로(페이징)

  useEffect(() => {
    const idx = weekIndexOf(centerGrid, selectedDate);
    selectedWeekIndex.value = idx >= 0 ? idx : 0;
  }, [centerGrid, selectedDate, selectedWeekIndex]);

  const shiftPage = (dir: 1 | -1) => {
    if (mode === 'month') {
      setCenter((c) => addMonths(c.year, c.month, dir));
    } else {
      const next = addDaysOnly(selectedDate, dir * 7);
      setSelectedDate(next);
      setCenter(monthOf(next));
    }
    haptics.selection();
  };

  // translateX 리셋은 새 데이터가 커밋된 프레임에 — shiftPage 안에서 하면
  // 리렌더 전 1프레임 동안 이전 달로 되돌아가는 플래시가 보인다
  useLayoutEffect(() => {
    dragX.value = 0;
  }, [center.year, center.month, selectedDate, dragX]);

  const syncMode = (m: 'month' | 'week') => {
    setMode(m);
    haptics.impact();
  };

  // ── 단일 Pan + 축 잠금 ───────────────────────────────
  const pan = Gesture.Pan()
    .minDistance(10)
    .onStart(() => {
      axis.value = 0;
      startProgress.value = progress.value;
    })
    .onUpdate((e) => {
      if (axis.value === 0) {
        // 첫 프레임 지터로 잘못 잠기지 않게, 이동량이 충분해진 뒤에만 축 판별
        const ax = Math.abs(e.translationX);
        const ay = Math.abs(e.translationY);
        if (Math.max(ax, ay) < 12) return;
        axis.value = ay >= ax ? 1 : 2;
      }
      if (axis.value === 1) {
        const p = startProgress.value - e.translationY / collapseDistance;
        progress.value = Math.min(1, Math.max(0, p));
      } else {
        dragX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      if (axis.value === 1) {
        const fast = Math.abs(e.velocityY) > 500;
        const target = fast ? (e.velocityY < 0 ? 1 : 0) : progress.value > 0.5 ? 1 : 0;
        progress.value = withSpring(target, springSnap, () => {
          runOnJS(syncMode)(target === 1 ? 'week' : 'month');
        });
      } else if (axis.value === 2) {
        const goNext = e.translationX < -width / 4 || e.velocityX < -500;
        const goPrev = e.translationX > width / 4 || e.velocityX > 500;
        if (!goNext && !goPrev) {
          dragX.value = withSpring(0, springSnap);
          return;
        }
        const dir: 1 | -1 = goNext ? 1 : -1;
        dragX.value = withSpring(-dir * width, springSnap, () => {
          runOnJS(shiftPage)(dir);
        });
      }
    });

  const gridContainerStyle = useAnimatedStyle(() => ({
    height: cellHeight + collapseDistance * (1 - progress.value),
    overflow: 'hidden' as const,
  }));

  const pagerStyle = useAnimatedStyle(() => ({
    flexDirection: 'row' as const,
    width: width * 3,
    transform: [{ translateX: -width + dragX.value }],
  }));

  const onSelectDate = (d: DateOnly) => {
    setSelectedDate(d);
    if (mode === 'month') {
      const m = monthOf(d);
      if (m.year !== center.year || m.month !== center.month) setCenter(m);
    }
    haptics.selection();
  };

  const goToday = () => {
    setSelectedDate(today);
    setCenter(monthOf(today));
    haptics.selection();
  };

  const isWeekMode = mode === 'week';

  const permissionBroken = usePermissionStore((s) => s.broken);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      {permissionBroken && (
        <Pressable
          style={styles.permBanner}
          onPress={() => router.push('/onboarding/permissions')}
        >
          <AppText variant="caption" color="white">
            ⚠️ 알람 권한이 깨졌습니다 — 탭해서 복구
          </AppText>
        </Pressable>
      )}
      <View style={styles.header}>
        <View>
          <AppText variant="micro" color="textDim" nums style={styles.yearLabel}>
            {center.year}
          </AppText>
          <AppText variant="display" nums style={styles.monthLabel}>
            {center.month}월
          </AppText>
        </View>
        <Pressable onPress={goToday} hitSlop={8}>
          <AppText variant="caption" color="accent">
            오늘
          </AppText>
        </Pressable>
      </View>

      <View style={styles.weekdays}>
        {WEEKDAY_LABELS.map((w, i) => (
          <AppText
            key={w}
            variant="micro"
            color={i >= 5 ? 'textDim' : 'textSub'}
            style={styles.weekdayLabel}
          >
            {w}
          </AppText>
        ))}
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View style={gridContainerStyle}>
          <Animated.View style={pagerStyle}>
            <MonthPage
              grid={isWeekMode ? prevWeekGrid : prevGrid}
              width={width}
              cellHeight={cellHeight}
              barsByRow={prevLayout.bars}
              overflow={prevLayout.overflow}
              progress={progress}
              selectedWeekIndex={sideWeekIndex}
              selectedDate={selectedDate}
              today={today}
              onSelectDate={onSelectDate}
            />
            <MonthPage
              grid={centerGrid}
              width={width}
              cellHeight={cellHeight}
              barsByRow={centerLayout.bars}
              overflow={centerLayout.overflow}
              progress={progress}
              selectedWeekIndex={selectedWeekIndex}
              selectedDate={selectedDate}
              today={today}
              onSelectDate={onSelectDate}
            />
            <MonthPage
              grid={isWeekMode ? nextWeekGrid : nextGrid}
              width={width}
              cellHeight={cellHeight}
              barsByRow={nextLayout.bars}
              overflow={nextLayout.overflow}
              progress={progress}
              selectedWeekIndex={sideWeekIndex}
              selectedDate={selectedDate}
              today={today}
              onSelectDate={onSelectDate}
            />
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      <DaySheet
        date={selectedDate}
        events={events ?? []}
        categories={categories ?? []}
        loading={isPending}
        tz={TZ}
        onPressEvent={(id) => router.push({ pathname: '/event/[id]', params: { id } })}
        onPressAdd={() =>
          router.push({ pathname: '/event/[id]', params: { id: 'new', date: selectedDate } })
        }
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    permBanner: {
      backgroundColor: colors.danger,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: 10,
      paddingVertical: spacing.sm,
      alignItems: 'center',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.lg,
    },
    yearLabel: { letterSpacing: 2 },
    monthLabel: { lineHeight: 38 },
    weekdays: {
      flexDirection: 'row',
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      marginBottom: spacing.xs,
    },
    weekdayLabel: { flex: 1, textAlign: 'center', letterSpacing: 1 },
  });

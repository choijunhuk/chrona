/**
 * 캘린더 화면 (stage-2 §1-4·1-5).
 * - progress(0=월, 1=주) 하나로 접기 전환 전부 구동 — 전 과정 UI 스레드
 * - 단일 Pan + 축 잠금: 시작 방향으로 세로(접기)/가로(페이징) 결정. Race 조합의 모호성 제거
 * - 드래그 중 runOnJS 0회. 스냅 완료 콜백에서 상태 동기화 1회만
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { spacing, spring, type ThemeColors } from '@/ui/tokens';

import { COLLAPSE_DISTANCE, CELL_HEIGHT, MONTH_HEIGHT } from './constants';
import { DaySheet } from './day-sheet';
import { MonthPage, type DayDots } from './month-page';

const TZ = 'Asia/Seoul';

export function CalendarScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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

  const dots = useMemo<DayDots>(() => {
    const catColor = new Map((categories ?? []).map((c) => [c.id, c.color]));
    const map: DayDots = {};
    const push = (d: string, color: string) => (map[d] = [...(map[d] ?? []), color]);
    const pushSpan = (from: DateOnly, to: DateOnly, color: string) => {
      let d = from;
      for (let i = 0; i < 60 && d <= to; i++) {
        push(d, color);
        d = addDaysOnly(d, 1);
      }
    };
    for (const e of events ?? []) {
      const color =
        e.color ?? (e.categoryId ? (catColor.get(e.categoryId) ?? colors.accent) : colors.accent);
      if (e.allDay && e.startDate) {
        pushSpan(e.startDate, e.endDate ?? e.startDate, color);
      } else if (e.startsAt) {
        // 자정을 넘는 일정은 걸치는 모든 날에 점 표시 (사용자 요청: 이어지는 일정)
        pushSpan(toDateOnly(e.startsAt, TZ), toDateOnly(e.endsAt ?? e.startsAt, TZ), color);
      } else if (e.dueAt) {
        push(toDateOnly(e.dueAt, TZ), color);
      }
    }
    return map;
  }, [events, categories, colors.accent]);

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
    console.log('[chrona] shiftPage', dir, mode);
    if (mode === 'month') {
      setCenter((c) => addMonths(c.year, c.month, dir));
    } else {
      const next = addDaysOnly(selectedDate, dir * 7);
      setSelectedDate(next);
      setCenter(monthOf(next));
    }
    dragX.value = 0; // 데이터 시프트와 동시 리셋 → 동일 프레임
    haptics.selection();
  };

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
        axis.value = Math.abs(e.translationY) >= Math.abs(e.translationX) ? 1 : 2;
      }
      if (axis.value === 1) {
        const p = startProgress.value - e.translationY / COLLAPSE_DISTANCE;
        progress.value = Math.min(1, Math.max(0, p));
      } else {
        dragX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      if (axis.value === 1) {
        const fast = Math.abs(e.velocityY) > 500;
        const target = fast ? (e.velocityY < 0 ? 1 : 0) : progress.value > 0.5 ? 1 : 0;
        progress.value = withSpring(target, spring, (finished) => {
          if (finished) runOnJS(syncMode)(target === 1 ? 'week' : 'month');
        });
      } else if (axis.value === 2) {
        const goNext = e.translationX < -width / 4 || e.velocityX < -500;
        const goPrev = e.translationX > width / 4 || e.velocityX > 500;
        if (!goNext && !goPrev) {
          dragX.value = withSpring(0, spring);
          return;
        }
        const dir: 1 | -1 = goNext ? 1 : -1;
        dragX.value = withSpring(-dir * width, spring, () => {
          runOnJS(shiftPage)(dir);
        });
      }
    });

  const gridContainerStyle = useAnimatedStyle(() => ({
    height: CELL_HEIGHT + (MONTH_HEIGHT - CELL_HEIGHT) * (1 - progress.value),
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

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <AppText variant="title" nums>
          {center.year}년 {center.month}월
        </AppText>
        <View style={styles.headerActions}>
          <Pressable onPress={goToday} style={styles.todayBtn}>
            <AppText variant="caption" color="accent">
              오늘
            </AppText>
          </Pressable>
        </View>
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
              progress={progress}
              selectedWeekIndex={sideWeekIndex}
              selectedDate={selectedDate}
              today={today}
              dots={dots}
              onSelectDate={onSelectDate}
            />
            <MonthPage
              grid={centerGrid}
              width={width}
              progress={progress}
              selectedWeekIndex={selectedWeekIndex}
              selectedDate={selectedDate}
              today={today}
              dots={dots}
              onSelectDate={onSelectDate}
            />
            <MonthPage
              grid={isWeekMode ? nextWeekGrid : nextGrid}
              width={width}
              progress={progress}
              selectedWeekIndex={sideWeekIndex}
              selectedDate={selectedDate}
              today={today}
              dots={dots}
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
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
    headerActions: { flexDirection: 'row', gap: spacing.md },
    todayBtn: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    weekdays: { flexDirection: 'row', paddingBottom: spacing.xs },
    weekdayLabel: { flex: 1, textAlign: 'center' },
  });

/**
 * 월 격자 1페이지. 6주 × 7일을 미리 전부 렌더하고,
 * progress(0=월간, 1=주간)에 따라 레이아웃만 변형한다 — 드래그 중 리마운트 금지 (stage-2 §1-4).
 * 모든 스타일 계산은 worklet (UI 스레드).
 */
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { MonthGridCell } from '@/domain/calendar';
import { dayOfMonth } from '@/domain/calendar';
import type { DateOnly } from '@/domain/time';
import { AppText } from '@/ui/components/text';
import { ColorDot } from '@/ui/components/color-dot';
import { colors, radius, spacing } from '@/ui/tokens';

import { CELL_HEIGHT } from './constants';

export type DayDots = Record<string, string[]>; // DateOnly -> 색상 최대 3 + 초과는 +N

type WeekRowProps = {
  week: MonthGridCell[];
  rowIndex: number;
  progress: SharedValue<number>;
  selectedWeekIndex: SharedValue<number>;
  selectedDate: DateOnly;
  today: DateOnly;
  dots: DayDots;
  onSelectDate: (d: DateOnly) => void;
};

const WeekRow = memo(function WeekRow({
  week,
  rowIndex,
  progress,
  selectedWeekIndex,
  selectedDate,
  today,
  dots,
  onSelectDate,
}: WeekRowProps) {
  const animStyle = useAnimatedStyle(() => {
    const isSelectedRow = selectedWeekIndex.value === rowIndex;
    return {
      // 선택된 주는 맨 위로 이동, 나머지는 따라 올라가며 사라짐
      transform: [
        { translateY: -selectedWeekIndex.value * CELL_HEIGHT * progress.value },
      ],
      opacity: isSelectedRow ? 1 : interpolate(progress.value, [0, 0.7], [1, 0]),
    };
  });

  return (
    <Animated.View style={[styles.row, animStyle]}>
      {week.map((cell) => {
        const isToday = cell.date === today;
        const isSelected = cell.date === selectedDate;
        const cellDots = dots[cell.date] ?? [];
        return (
          <Pressable key={cell.date} style={styles.cell} onPress={() => onSelectDate(cell.date)}>
            <View
              style={[
                styles.dayCircle,
                isToday && styles.todayRing,
                isSelected && styles.selectedFill,
              ]}
            >
              <AppText
                variant="caption"
                nums
                color={cell.inMonth ? (isSelected ? 'bg' : 'text') : 'textDim'}
                style={styles.dayNum}
              >
                {dayOfMonth(cell.date)}
              </AppText>
            </View>
            <View style={styles.dotsRow}>
              {cellDots.slice(0, 3).map((c, i) => (
                <ColorDot key={i} color={c} size={4} />
              ))}
              {cellDots.length > 3 && (
                <AppText variant="micro" color="textDim">
                  +{cellDots.length - 3}
                </AppText>
              )}
            </View>
          </Pressable>
        );
      })}
    </Animated.View>
  );
});

type MonthPageProps = {
  grid: MonthGridCell[][];
  progress: SharedValue<number>;
  selectedWeekIndex: SharedValue<number>;
  selectedDate: DateOnly;
  today: DateOnly;
  dots: DayDots;
  onSelectDate: (d: DateOnly) => void;
  width: number;
};

export function MonthPage({ grid, width, ...rowProps }: MonthPageProps) {
  return (
    <View style={{ width }}>
      {grid.map((week, i) => (
        <WeekRow key={week[0].date} week={week} rowIndex={i} {...rowProps} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', height: CELL_HEIGHT },
  cell: { flex: 1, alignItems: 'center', paddingTop: spacing.xs },
  dayCircle: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayRing: { borderWidth: 1.5, borderColor: colors.accent },
  selectedFill: { backgroundColor: colors.accent },
  dayNum: { lineHeight: 18 },
  dotsRow: { flexDirection: 'row', gap: 3, marginTop: 2, alignItems: 'center', height: 10 },
});

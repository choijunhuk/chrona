/**
 * 월 격자 1페이지. 6주 × 7일을 미리 전부 렌더하고,
 * progress(0=월간, 1=주간)에 따라 레이아웃만 변형한다 — 드래그 중 리마운트 금지 (stage-2 §1-4).
 * 여러 날에 걸치는 일정은 주 행마다 이어지는 바로 표시 (구글캘린더식).
 */
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { MonthGridCell } from '@/domain/calendar';
import { dayOfMonth } from '@/domain/calendar';
import type { DateOnly } from '@/domain/time';
import { AppText } from '@/ui/components/text';
import { ColorDot } from '@/ui/components/color-dot';
import { useTheme } from '@/ui/theme';
import { radius, spacing } from '@/ui/tokens';

export type DayDots = Record<string, string[]>; // 단일 일정: DateOnly -> 색상들

/** 주 행 하나에 걸친 연속 바 세그먼트 (col: 0~6) */
export type WeekBar = { startCol: number; endCol: number; color: string; lane: number };

const MAX_LANES = 2;

type WeekRowProps = {
  week: MonthGridCell[];
  rowIndex: number;
  cellHeight: number;
  bars: WeekBar[];
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
  cellHeight,
  bars,
  progress,
  selectedWeekIndex,
  selectedDate,
  today,
  dots,
  onSelectDate,
}: WeekRowProps) {
  const { colors } = useTheme();

  const animStyle = useAnimatedStyle(() => {
    const isSelectedRow = selectedWeekIndex.value === rowIndex;
    return {
      transform: [{ translateY: -selectedWeekIndex.value * cellHeight * progress.value }],
      opacity: isSelectedRow ? 1 : interpolate(progress.value, [0, 0.7], [1, 0]),
    };
  });

  const dayColor = (i: number, cell: MonthGridCell, isSelected: boolean) => {
    if (isSelected) return 'white' as const;
    if (!cell.inMonth) return 'textDim' as const;
    if (i === 6) return 'danger' as const; // 일요일
    if (i === 5) return 'accent' as const; // 토요일
    return 'text' as const;
  };

  return (
    <Animated.View style={[styles.row, { height: cellHeight }, animStyle]}>
      {week.map((cell, i) => {
        const isToday = cell.date === today;
        const isSelected = cell.date === selectedDate;
        const cellDots = dots[cell.date] ?? [];
        return (
          <Pressable key={cell.date} style={styles.cell} onPress={() => onSelectDate(cell.date)}>
            <View
              style={[
                styles.dayCircle,
                isToday && { borderWidth: 1.5, borderColor: colors.accent },
                isSelected && { backgroundColor: colors.accent },
              ]}
            >
              <AppText
                variant="caption"
                nums
                color={dayColor(i, cell, isSelected)}
                style={styles.dayNum}
              >
                {dayOfMonth(cell.date)}
              </AppText>
            </View>
            <View style={styles.dotsRow}>
              {cellDots.slice(0, 3).map((c, j) => (
                <ColorDot key={j} color={c} size={4} />
              ))}
              {cellDots.length > 3 && (
                <AppText variant="micro" color="textDim" style={styles.moreCount}>
                  +{Math.min(cellDots.length - 3, 9)}
                </AppText>
              )}
            </View>
          </Pressable>
        );
      })}

      {/* 연속 바 — 셀 위에 절대 배치, 터치는 셀로 통과 */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {bars.map((b, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              {
                top: cellHeight - 18 + b.lane * 7,
                left: `${(b.startCol / 7) * 100 + 0.7}%`,
                width: `${((b.endCol - b.startCol + 1) / 7) * 100 - 1.4}%`,
                backgroundColor: b.color,
              },
            ]}
          />
        ))}
      </View>
    </Animated.View>
  );
});

type MonthPageProps = {
  grid: MonthGridCell[][];
  width: number;
  cellHeight: number;
  barsByRow: WeekBar[][];
  progress: SharedValue<number>;
  selectedWeekIndex: SharedValue<number>;
  selectedDate: DateOnly;
  today: DateOnly;
  dots: DayDots;
  onSelectDate: (d: DateOnly) => void;
};

export function MonthPage({ grid, width, barsByRow, ...rowProps }: MonthPageProps) {
  return (
    <View style={{ width }}>
      {grid.map((week, i) => (
        <WeekRow
          key={week[0].date}
          week={week}
          rowIndex={i}
          bars={barsByRow[i] ?? []}
          {...rowProps}
        />
      ))}
    </View>
  );
}

export { MAX_LANES };

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingTop: spacing.xs },
  dayCircle: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNum: { lineHeight: 18 },
  dotsRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 2,
    alignItems: 'center',
    height: 12,
    overflow: 'hidden',
  },
  moreCount: { fontSize: 9, lineHeight: 11 },
  bar: {
    position: 'absolute',
    height: 5,
    borderRadius: radius.full,
    opacity: 0.9,
  },
});

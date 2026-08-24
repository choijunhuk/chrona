/**
 * 월 격자 1페이지 (stage-2 §1-4).
 * 6주 × 7일을 미리 전부 렌더하고 progress(0=월간, 1=주간)로 레이아웃만 변형.
 *
 * 일정 표기: 점 대신 제목이 실린 필(pill). 단일·연속 일정 동일 시스템 —
 * 연속 일정은 주 행을 가로질러 이어지고 제목은 각 주의 시작 세그먼트에만 표시.
 */
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { MonthGridCell } from '@/domain/calendar';
import { dayOfMonth } from '@/domain/calendar';
import type { DateOnly } from '@/domain/time';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing } from '@/ui/tokens';

/** 주 행에 걸친 일정 세그먼트 (col 0~6). title은 세그먼트 시작에만 그린다 */
export type WeekBar = {
  startCol: number;
  endCol: number;
  color: string;
  lane: number;
  title: string | null;
};

/** 레인에 못 들어간 일정 수: DateOnly -> N */
export type OverflowMap = Record<string, number>;

export const MAX_LANES = 3;
export const DAY_NUM_AREA = 26;
export const LANE_HEIGHT = 17;

type WeekRowProps = {
  week: MonthGridCell[];
  rowIndex: number;
  cellHeight: number;
  bars: WeekBar[];
  overflow: OverflowMap;
  progress: SharedValue<number>;
  selectedWeekIndex: SharedValue<number>;
  selectedDate: DateOnly;
  today: DateOnly;
  onSelectDate: (d: DateOnly) => void;
};

const WeekRow = memo(function WeekRow({
  week,
  rowIndex,
  cellHeight,
  bars,
  overflow,
  progress,
  selectedWeekIndex,
  selectedDate,
  today,
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

  const numColor = (i: number, cell: MonthGridCell, isToday: boolean) => {
    if (isToday) return 'white' as const;
    if (!cell.inMonth) return 'textDim' as const;
    if (i === 6) return 'danger' as const;
    if (i === 5) return 'accent' as const;
    return 'text' as const;
  };

  return (
    <Animated.View style={[styles.row, { height: cellHeight }, animStyle]}>
      {week.map((cell, i) => {
        const isToday = cell.date === today;
        const isSelected = cell.date === selectedDate;
        const over = overflow[cell.date] ?? 0;
        return (
          <Pressable key={cell.date} style={styles.cell} onPress={() => onSelectDate(cell.date)}>
            {isSelected && (
              <View
                pointerEvents="none"
                style={[styles.selectedBg, { backgroundColor: `${colors.accent}1A` }]}
              />
            )}
            <View style={[styles.dayNumWrap, isToday && { backgroundColor: colors.accent }]}>
              <AppText variant="micro" nums color={numColor(i, cell, isToday)} style={styles.dayNum}>
                {dayOfMonth(cell.date)}
              </AppText>
            </View>
            {over > 0 && (
              <AppText variant="micro" color="textDim" style={styles.overflow}>
                +{Math.min(over, 9)}
              </AppText>
            )}
          </Pressable>
        );
      })}

      {/* 일정 필 레이어 — 터치는 셀로 통과 */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {bars.map((b, i) => (
          <View
            key={i}
            style={[
              styles.pill,
              {
                top: DAY_NUM_AREA + b.lane * LANE_HEIGHT,
                left: `${(b.startCol / 7) * 100 + 0.5}%`,
                width: `${((b.endCol - b.startCol + 1) / 7) * 100 - 1}%`,
                backgroundColor: `${b.color}30`,
              },
            ]}
          >
            {b.title !== null && (
              <AppText
                variant="micro"
                numberOfLines={1}
                style={[styles.pillText, { color: b.color }]}
              >
                {b.title}
              </AppText>
            )}
          </View>
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
  overflow: OverflowMap;
  progress: SharedValue<number>;
  selectedWeekIndex: SharedValue<number>;
  selectedDate: DateOnly;
  today: DateOnly;
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  cell: { flex: 1, paddingTop: 3, paddingHorizontal: 2 },
  selectedBg: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: radius.sm,
  },
  dayNumWrap: {
    alignSelf: 'flex-start',
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginLeft: 2,
  },
  dayNum: { lineHeight: 14 },
  overflow: {
    position: 'absolute',
    bottom: 1,
    right: spacing.xs,
    fontSize: 9,
    lineHeight: 11,
  },
  pill: {
    position: 'absolute',
    height: LANE_HEIGHT - 3,
    borderRadius: 4,
    justifyContent: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  pillText: { fontSize: 9.5, lineHeight: 12, fontWeight: '600' },
});

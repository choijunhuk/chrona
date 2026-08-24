/**
 * 선택한 날의 일정 하단 시트 (stage-2 §1-5·1-6·1-8).
 * 3단 스냅 (peek / half / full). full에서는 타임라인 뷰.
 */
import BottomSheet, { BottomSheetFlashList, BottomSheetView } from '@gorhom/bottom-sheet';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import type { Category, ChronaEvent } from '@/domain/types';
import { formatTimeLabel, type DateOnly, toDateOnly } from '@/domain/time';
import { ColorDot } from '@/ui/components/color-dot';
import { Skeleton } from '@/ui/components/skeleton';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { darkColors, radius, spacing, type ThemeColors } from '@/ui/tokens';

import { TimelineDay } from './timeline-day';

type Props = {
  date: DateOnly;
  events: ChronaEvent[];
  categories: Category[];
  loading: boolean;
  tz: string;
  onPressEvent: (id: string) => void;
  onPressAdd: () => void;
};

export function eventColor(e: ChronaEvent, categories: Category[]): string {
  return e.color ?? categories.find((c) => c.id === e.categoryId)?.color ?? darkColors.accent;
}

export function DaySheet({ date, events, categories, loading, tz, onPressEvent, onPressAdd }: Props) {
  const sheetRef = useRef<BottomSheet>(null);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [snapIndex, setSnapIndex] = useState(0);
  const snapPoints = useMemo(() => ['14%', '45%', '90%'], []);

  const dayEvents = useMemo(() => {
    const timed: ChronaEvent[] = [];
    const allDay: ChronaEvent[] = [];
    for (const e of events) {
      if (e.allDay && e.startDate) {
        if (e.startDate <= date && date <= (e.endDate ?? e.startDate)) allDay.push(e);
      } else if (e.startsAt) {
        // 자정을 넘는 일정: 걸치는 모든 날에 표시 (사용자 요청)
        const spanStart = toDateOnly(e.startsAt, tz);
        const spanEnd = toDateOnly(e.endsAt ?? e.startsAt, tz);
        if (spanStart <= date && date <= spanEnd) timed.push(e);
      } else if (e.kind === 'task' && e.dueAt && toDateOnly(e.dueAt, tz) === date) {
        timed.push(e);
      }
    }
    timed.sort(
      (a, b) => (a.startsAt ?? a.dueAt ?? new Date(0)).getTime() - (b.startsAt ?? b.dueAt ?? new Date(0)).getTime()
    );
    return { timed, allDay };
  }, [events, date, tz]);

  const renderItem = useCallback(
    ({ item, index }: { item: ChronaEvent; index: number }) => {
      const at = item.startsAt ?? item.dueAt;
      return (
        <Animated.View entering={FadeInDown.delay(index * 20)}>
          <Pressable style={styles.item} onPress={() => onPressEvent(item.id)}>
            <View style={[styles.colorBar, { backgroundColor: eventColor(item, categories) }]} />
            <View style={styles.itemBody}>
              <AppText variant="body" style={item.isDone ? styles.done : undefined}>
                {item.title}
              </AppText>
              <AppText variant="caption" color="textSub" nums>
                {at ? formatTimeLabel(at, tz) : ''}
                {item.endsAt ? ` ~ ${formatTimeLabel(item.endsAt, tz)}` : ''}
                {item.location ? ` · ${item.location}` : ''}
              </AppText>
            </View>
          </Pressable>
        </Animated.View>
      );
    },
    [categories, onPressEvent, tz, styles]
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      onChange={setSnapIndex}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetView style={styles.sheetHeader}>
        <AppText variant="caption" color="textSub" nums>
          {date}
        </AppText>
        <Pressable onPress={onPressAdd} style={styles.addBtn}>
          <AppText variant="caption" color="accent">
            + 추가
          </AppText>
        </Pressable>
      </BottomSheetView>

      {loading ? (
        <BottomSheetView style={styles.skeletons}>
          <Skeleton style={styles.skeletonLine} />
          <Skeleton style={[styles.skeletonLine, styles.skeletonShort]} />
        </BottomSheetView>
      ) : snapIndex === 2 ? (
        <TimelineDay
          date={date}
          events={dayEvents.timed}
          allDayEvents={dayEvents.allDay}
          categories={categories}
          tz={tz}
          onPressEvent={onPressEvent}
        />
      ) : (
        <>
          {dayEvents.allDay.length > 0 && (
            <BottomSheetView style={styles.allDayRow}>
              {dayEvents.allDay.map((e) => (
                <Pressable key={e.id} style={styles.allDayChip} onPress={() => onPressEvent(e.id)}>
                  <ColorDot color={eventColor(e, categories)} size={6} />
                  <AppText variant="caption">{e.title}</AppText>
                </Pressable>
              ))}
            </BottomSheetView>
          )}
          {dayEvents.timed.length === 0 && dayEvents.allDay.length === 0 ? (
            <BottomSheetView style={styles.empty}>
              <AppText variant="caption" color="textDim">
                일정이 없습니다
              </AppText>
            </BottomSheetView>
          ) : (
            <BottomSheetFlashList
              data={dayEvents.timed}
              keyExtractor={(e: ChronaEvent) => e.id}
              renderItem={renderItem}
              estimatedItemSize={56}
              contentContainerStyle={styles.listContent}
            />
          )}
        </>
      )}
    </BottomSheet>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  sheetBg: { backgroundColor: colors.surface, borderRadius: radius.lg },
  handle: { backgroundColor: colors.border },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  addBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  item: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
  colorBar: { width: 3, borderRadius: radius.full },
  itemBody: { gap: 2 },
  done: { textDecorationLine: 'line-through', color: colors.textDim },
  allDayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  allDayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  empty: { alignItems: 'center', paddingTop: spacing.x32, gap: spacing.md },
  listContent: { paddingBottom: spacing.x40 },
  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.sm },
  skeletonLine: { height: 20 },
  skeletonShort: { width: '60%' },
});

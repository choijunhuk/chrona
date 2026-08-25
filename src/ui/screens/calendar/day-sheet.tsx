/**
 * 선택한 날의 일정 하단 시트 (stage-2 §1-5·1-6·1-8).
 * 3단 스냅 (peek / half / full). full에서는 타임라인 뷰.
 */
import BottomSheet, { BottomSheetFlashList } from '@gorhom/bottom-sheet';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { formatKoreanDate } from '@/domain/calendar';
import type { DisplayItem } from '@/domain/display';
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
  items: DisplayItem[];
  categories: Category[];
  loading: boolean;
  tz: string;
  onPressEvent: (id: string, occ?: string) => void;
  onPressAdd: () => void;
};

export function eventColor(e: ChronaEvent, categories: Category[]): string {
  return e.color ?? categories.find((c) => c.id === e.categoryId)?.color ?? darkColors.accent;
}

export function DaySheet({ date, items, categories, loading, tz, onPressEvent, onPressAdd }: Props) {
  const sheetRef = useRef<BottomSheet>(null);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [snapIndex, setSnapIndex] = useState(0);
  const snapPoints = useMemo(() => ['16%', '45%', '90%'], []);

  // 반복 전개된 DisplayItem 기준 (stage-5). timed는 회차별 사본 이벤트로 변환해 기존 렌더 재사용
  const dayEvents = useMemo(() => {
    const timed: ChronaEvent[] = [];
    const allDay: ChronaEvent[] = [];
    for (const it of items) {
      if (it.startDate) {
        if (it.startDate <= date && date <= (it.endDate ?? it.startDate)) allDay.push(it.event);
      } else if (it.start) {
        const spanStart = toDateOnly(it.start, tz);
        const spanEnd = toDateOnly(it.end ?? it.start, tz);
        if (spanStart <= date && date <= spanEnd) {
          timed.push(
            it.event.kind === 'task'
              ? it.event
              : { ...it.event, startsAt: it.start, endsAt: it.end }
          );
        }
      }
    }
    timed.sort(
      (a, b) =>
        (a.startsAt ?? a.dueAt ?? new Date(0)).getTime() -
        (b.startsAt ?? b.dueAt ?? new Date(0)).getTime()
    );
    return { timed, allDay };
  }, [items, date, tz]);

  const renderItem = useCallback(
    ({ item, index }: { item: ChronaEvent; index: number }) => {
      const at = item.startsAt ?? item.dueAt;
      return (
        <Animated.View entering={FadeInDown.delay(index * 20)}>
          <Pressable
            style={styles.item}
            onPress={() => onPressEvent(item.id, item.startsAt?.toISOString())}
          >
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
      <View style={styles.sheetHeader}>
        <AppText variant="title" nums style={styles.dateTitle}>
          {formatKoreanDate(date)}
        </AppText>
        <Pressable onPress={onPressAdd} style={styles.addBtn}>
          <AppText variant="caption" color="accent">
            + 추가
          </AppText>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.skeletons}>
          <Skeleton style={styles.skeletonLine} />
          <Skeleton style={[styles.skeletonLine, styles.skeletonShort]} />
        </View>
      ) : snapIndex === 2 ? (
        <TimelineDay
          date={date}
          events={dayEvents.timed}
          allDayEvents={dayEvents.allDay}
          categories={categories}
          tz={tz}
          onPressEvent={onPressEvent}
        />
      ) : dayEvents.timed.length === 0 && dayEvents.allDay.length === 0 ? (
        <View style={styles.empty}>
          <AppText variant="caption" color="textDim">
            일정이 없습니다
          </AppText>
        </View>
      ) : (
        // 종일 칩은 리스트 헤더로 — peek 높이에서 목록과 겹치지 않게 같이 스크롤
        <BottomSheetFlashList
          data={dayEvents.timed}
          keyExtractor={(e: ChronaEvent) => e.id}
          renderItem={renderItem}
          estimatedItemSize={56}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            dayEvents.allDay.length > 0 ? (
              <View style={styles.allDayRow}>
                {dayEvents.allDay.map((e) => (
                  <Pressable
                    key={e.id}
                    style={styles.allDayChip}
                    onPress={() => onPressEvent(e.id)}
                  >
                    <ColorDot color={eventColor(e, categories)} size={6} />
                    <AppText variant="caption">{e.title}</AppText>
                  </Pressable>
                ))}
              </View>
            ) : null
          }
        />
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
  item: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  colorBar: { width: 4, borderRadius: radius.full },
  itemBody: { gap: 2, flex: 1 },
  dateTitle: { fontSize: 17 },
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

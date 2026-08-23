/**
 * 선택한 날의 타임라인 (stage-2 §1-8). 시트 full 상태에서 표시.
 * 0~24시 세로 그리드, 겹치는 일정 가로 분할, 현재 시각 accent 라인.
 */
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Category, ChronaEvent } from '@/domain/types';
import { formatTimeLabel, toDateOnly, type DateOnly } from '@/domain/time';
import { AppText } from '@/ui/components/text';
import { colors, radius, spacing } from '@/ui/tokens';

import { eventColor } from './day-sheet';

const HOUR_HEIGHT = 56;
const TIME_COL = 48;

type Block = {
  event: ChronaEvent;
  top: number;
  height: number;
  col: number;
  cols: number;
};

/** 겹침 → 가로 분할. n²이지만 하루 일정 수십 개 수준 (ponytail: 충분) */
function layoutBlocks(events: ChronaEvent[], tz: string, date: DateOnly): Block[] {
  const items = events
    .filter((e) => e.startsAt)
    .map((e) => {
      const start = e.startsAt as Date;
      const end = e.endsAt ?? new Date(start.getTime() + 3600_000);
      const dayStartMin = toDateOnly(start, tz) === date ? minutesOfDay(start, tz) : 0;
      const dayEndMin = toDateOnly(end, tz) === date ? minutesOfDay(end, tz) : 24 * 60;
      return { e, startMin: dayStartMin, endMin: Math.max(dayEndMin, dayStartMin + 20) };
    })
    .sort((a, b) => a.startMin - b.startMin);

  const blocks: Block[] = [];
  for (const it of items) {
    const overlapping = blocks.filter((b) => {
      const bStart = (b.top / HOUR_HEIGHT) * 60;
      const bEnd = bStart + (b.height / HOUR_HEIGHT) * 60;
      return it.startMin < bEnd && bStart < it.endMin;
    });
    const usedCols = new Set(overlapping.map((b) => b.col));
    let col = 0;
    while (usedCols.has(col)) col++;
    const cols = Math.max(col + 1, ...overlapping.map((b) => b.cols), 1);
    const block: Block = {
      event: it.e,
      top: (it.startMin / 60) * HOUR_HEIGHT,
      height: ((it.endMin - it.startMin) / 60) * HOUR_HEIGHT,
      col,
      cols,
    };
    overlapping.forEach((b) => (b.cols = cols));
    blocks.push(block);
  }
  return blocks;
}

function minutesOfDay(d: Date, tz: string): number {
  const label = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  const [h, m] = label.split(':').map(Number);
  return h * 60 + m;
}

type Props = {
  date: DateOnly;
  events: ChronaEvent[];
  allDayEvents: ChronaEvent[];
  categories: Category[];
  tz: string;
  onPressEvent: (id: string) => void;
};

export function TimelineDay({ date, events, allDayEvents, categories, tz, onPressEvent }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const blocks = useMemo(() => layoutBlocks(events, tz, date), [events, tz, date]);

  const isToday = toDateOnly(new Date(), tz) === date;
  const nowMin = isToday ? minutesOfDay(new Date(), tz) : null;

  // 진입 시 현재 시각(또는 첫 일정)으로 스크롤
  useEffect(() => {
    const target = nowMin ?? (blocks[0] ? (blocks[0].top / HOUR_HEIGHT) * 60 : 8 * 60);
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, (target / 60) * HOUR_HEIGHT - 120), animated: false });
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <BottomSheetScrollView ref={scrollRef} contentContainerStyle={styles.content}>
      {allDayEvents.length > 0 && (
        <View style={styles.allDayRow}>
          {allDayEvents.map((e) => (
            <Pressable
              key={e.id}
              style={[styles.allDayChip, { borderColor: eventColor(e, categories) }]}
              onPress={() => onPressEvent(e.id)}
            >
              <AppText variant="caption">{e.title}</AppText>
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ height: 24 * HOUR_HEIGHT }}>
        {Array.from({ length: 24 }, (_, h) => (
          <View key={h} style={[styles.hourRow, { top: h * HOUR_HEIGHT }]}>
            <AppText variant="micro" color="textDim" nums style={styles.hourLabel}>
              {String(h).padStart(2, '0')}:00
            </AppText>
            <View style={styles.hourLine} />
          </View>
        ))}

        <View style={styles.blockArea}>
          {blocks.map((b) => (
            <Pressable
              key={b.event.id}
              onPress={() => onPressEvent(b.event.id)}
              style={[
                styles.block,
                {
                  top: b.top,
                  height: Math.max(b.height, 28),
                  left: `${(100 / b.cols) * b.col}%`,
                  width: `${100 / b.cols}%`,
                  borderLeftColor: eventColor(b.event, categories),
                },
              ]}
            >
              <AppText variant="micro" numberOfLines={1}>
                {b.event.title}
              </AppText>
              {b.event.startsAt && (
                <AppText variant="micro" color="textSub" nums>
                  {formatTimeLabel(b.event.startsAt, tz)}
                </AppText>
              )}
            </Pressable>
          ))}
        </View>

        {nowMin !== null && (
          <View style={[styles.nowLine, { top: (nowMin / 60) * HOUR_HEIGHT }]}>
            <View style={styles.nowDot} />
          </View>
        )}
      </View>
    </BottomSheetScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.x40, paddingLeft: 0 },
  allDayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  allDayChip: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  hourRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  hourLabel: { width: TIME_COL, textAlign: 'center' },
  hourLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  blockArea: {
    position: 'absolute',
    left: TIME_COL,
    right: spacing.sm,
    top: 0,
    bottom: 0,
  },
  block: {
    position: 'absolute',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    padding: spacing.xs,
  },
  nowLine: {
    position: 'absolute',
    left: TIME_COL,
    right: 0,
    height: 2,
    backgroundColor: colors.accent,
  },
  nowDot: {
    position: 'absolute',
    left: -4,
    top: -3,
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});

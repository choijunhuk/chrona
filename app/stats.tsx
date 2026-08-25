/**
 * 통계 (stage-7 §2-4). 지표 4종만 — 늘리지 않는다.
 * 차트는 SVG 정적 렌더 (진입 1회 애니 없음 = 반복 애니 금지 규칙 자동 충족).
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { useEvents } from '@/data/hooks/events';
import { useOverrides } from '@/data/hooks/overrides';
import { useFocusSessions } from '@/data/hooks/focus';
import { useCategories } from '@/data/hooks/settings';
import { useTasks } from '@/data/hooks/tasks';
import { addDaysOnly, weekOf } from '@/domain/calendar';
import { expandForDisplay } from '@/domain/display';
import {
  focusStreak,
  plannedVsActual,
  taskCompletionRate,
  weeklyCategoryBreakdown,
  type StatOccurrence,
} from '@/domain/stats';
import { fromDateOnly, todayDateOnly } from '@/domain/time';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { palette, radius, spacing, type ThemeColors } from '@/ui/tokens';

const TZ = 'Asia/Seoul';
const W = 320;

function fmtH(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

export default function Stats() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const today = todayDateOnly(TZ);

  const [weekShift, setWeekShift] = useState(0);
  const weekDays = useMemo(
    () => weekOf(addDaysOnly(today, weekShift * 7)),
    [today, weekShift]
  );
  const range = useMemo(
    () => ({
      from: fromDateOnly(weekDays[0], TZ),
      to: new Date(fromDateOnly(weekDays[6], TZ).getTime() + 86400_000 - 1),
    }),
    [weekDays]
  );

  const { data: events } = useEvents({ ...range, tz: TZ });
  const { data: overrides } = useOverrides();
  const { data: sessions } = useFocusSessions();
  const { data: categories } = useCategories();
  const { data: tasks } = useTasks();

  // 전개 (override 반영 — 휴강 회차 제외됨. 검증 2·3)
  const occurrences = useMemo<StatOccurrence[]>(() => {
    const items = expandForDisplay(events ?? [], overrides ?? [], range, TZ);
    return items
      .filter((it) => it.start && it.end && it.event.kind !== 'task')
      .map((it) => ({ categoryId: it.event.categoryId, start: it.start!, end: it.end }));
  }, [events, overrides, range]);

  const daily = useMemo(
    () => plannedVsActual(occurrences, sessions ?? [], weekDays, TZ),
    [occurrences, sessions, weekDays]
  );
  const slices = useMemo(
    () => weeklyCategoryBreakdown(occurrences, categories ?? [], range),
    [occurrences, categories, range]
  );
  const monthRange = useMemo(() => {
    const from = new Date();
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 1);
    return { from, to };
  }, []);
  const completion = useMemo(
    () => taskCompletionRate(tasks ?? [], monthRange),
    [tasks, monthRange]
  );
  const streak = useMemo(() => focusStreak(sessions ?? [], today, TZ), [sessions, today]);

  const maxDaily = Math.max(60, ...daily.map((d) => Math.max(d.plannedMinutes, d.actualMinutes)));
  const totalPlanned = daily.reduce((a, d) => a + d.plannedMinutes, 0);
  const totalActual = daily.reduce((a, d) => a + d.actualMinutes, 0);
  const totalSlices = slices.reduce((a, s0) => a + s0.minutes, 0);
  const isEmpty = totalPlanned === 0 && totalActual === 0 && totalSlices === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
    >
      <View style={styles.header}>
        <Pressable hitSlop={8} onPress={() => setWeekShift((w) => w - 1)}>
          <AppText variant="title" color="textSub">‹</AppText>
        </Pressable>
        <AppText variant="title" nums>
          {weekShift === 0 ? '이번 주' : weekShift === -1 ? '지난 주' : `${weekDays[0]} 주`}
        </AppText>
        <Pressable hitSlop={8} onPress={() => setWeekShift((w) => Math.min(0, w + 1))}>
          <AppText variant="title" color={weekShift === 0 ? 'textDim' : 'textSub'}>›</AppText>
        </Pressable>
      </View>

      {isEmpty && (
        <View style={styles.card}>
          <AppText color="textDim">아직 기록이 없어요</AppText>
        </View>
      )}

      {/* 계획 vs 실제 — 주인공 */}
      <View style={styles.card}>
        <AppText variant="micro" color="textDim" style={styles.cardLabel}>
          계획 vs 실제
        </AppText>
        <AppText variant="caption" color="textSub" nums>
          계획 {fmtH(totalPlanned)} · 집중 {fmtH(totalActual)}
          {totalPlanned > 0 ? ` (${Math.round((totalActual / totalPlanned) * 100)}%)` : ''}
        </AppText>
        <Svg width={W} height={140}>
          {daily.map((d, i) => {
            const x = (i * W) / 7 + 6;
            const bw = W / 7 / 2 - 8;
            const ph = (d.plannedMinutes / maxDaily) * 100;
            const ah = (d.actualMinutes / maxDaily) * 100;
            return (
              <G key={d.date}>
                <Rect x={x} y={120 - ph} width={bw} height={ph} rx={3} fill={colors.surfaceAlt} />
                <Rect x={x + bw + 3} y={120 - ah} width={bw} height={ah} rx={3} fill={colors.accent} />
              </G>
            );
          })}
        </Svg>
        <View style={styles.axisRow}>
          {['월', '화', '수', '목', '금', '토', '일'].map((d) => (
            <AppText key={d} variant="micro" color="textDim" style={styles.axisLabel}>
              {d}
            </AppText>
          ))}
        </View>
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: colors.surfaceAlt }]} />
          <AppText variant="micro" color="textSub">계획</AppText>
          <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
          <AppText variant="micro" color="textSub">실제 집중</AppText>
        </View>
      </View>

      {/* 시간 배분 도넛 */}
      <View style={styles.card}>
        <AppText variant="micro" color="textDim" style={styles.cardLabel}>
          시간 배분
        </AppText>
        {totalSlices === 0 ? (
          <AppText color="textDim">이 주엔 시간이 잡힌 일정이 없어요</AppText>
        ) : (
          <View style={styles.donutRow}>
            <Svg width={120} height={120}>
              {(() => {
                let acc = 0;
                return slices.map((s0, i) => {
                  const frac = s0.minutes / totalSlices;
                  const a0 = acc * 2 * Math.PI - Math.PI / 2;
                  acc += frac;
                  const a1 = acc * 2 * Math.PI - Math.PI / 2;
                  const large = frac > 0.5 ? 1 : 0;
                  const r = 50;
                  const cx = 60;
                  const cy = 60;
                  const p = `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
                  return (
                    <Path
                      key={i}
                      d={p}
                      stroke={s0.color ?? palette[i % palette.length]}
                      strokeWidth={16}
                      fill="none"
                    />
                  );
                });
              })()}
            </Svg>
            <View style={styles.donutLegend}>
              {slices.slice(0, 5).map((s0, i) => (
                <View key={i} style={styles.legendRow}>
                  <View
                    style={[styles.legendDot, { backgroundColor: s0.color ?? palette[i % palette.length] }]}
                  />
                  <AppText variant="caption">{s0.name}</AppText>
                  <AppText variant="caption" color="textSub" nums>
                    {fmtH(s0.minutes)}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* 완료율 + 스트릭 */}
      <View style={styles.twinRow}>
        <View style={[styles.card, styles.twin]}>
          <AppText variant="micro" color="textDim" style={styles.cardLabel}>
            이번 달 과제
          </AppText>
          <View style={styles.ringWrap}>
            <Svg width={72} height={72}>
              <Circle cx={36} cy={36} r={30} stroke={colors.surfaceAlt} strokeWidth={8} fill="none" />
              {completion.total > 0 && (
                <Circle
                  cx={36}
                  cy={36}
                  r={30}
                  stroke={colors.success}
                  strokeWidth={8}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 30}
                  strokeDashoffset={2 * Math.PI * 30 * (1 - completion.done / completion.total)}
                  transform="rotate(-90 36 36)"
                />
              )}
            </Svg>
            <AppText nums style={styles.ringText}>
              {completion.done}/{completion.total}
            </AppText>
          </View>
          {completion.late > 0 && (
            <AppText variant="micro" color="textSub" nums>
              마감 후 완료 {completion.late}
            </AppText>
          )}
        </View>
        <View style={[styles.card, styles.twin]}>
          <AppText variant="micro" color="textDim" style={styles.cardLabel}>
            연속 집중
          </AppText>
          <AppText variant="display" nums>
            {streak.current}일
          </AppText>
          <AppText variant="micro" color="textSub" nums>
            최고 {streak.best}일
          </AppText>
        </View>
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.x40 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    cardLabel: { letterSpacing: 2 },
    axisRow: { flexDirection: 'row', width: W },
    axisLabel: { flex: 1, textAlign: 'center' },
    legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    legendDot: { width: 8, height: 8, borderRadius: radius.full },
    donutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
    donutLegend: { gap: spacing.xs, flex: 1 },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    twinRow: { flexDirection: 'row', gap: spacing.lg },
    twin: { flex: 1, alignItems: 'center' },
    ringWrap: { alignItems: 'center', justifyContent: 'center' },
    ringText: { position: 'absolute', fontWeight: '600' },
  });

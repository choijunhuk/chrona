/**
 * 홈 탭 (stage-4 §1-5). 스크롤 없이 핵심이 한 화면에.
 * 남은 시간은 60초 interval — 포커스 잃으면 정지 (master §6).
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEvents } from '@/data/hooks/events';
import { useOverrides } from '@/data/hooks/overrides';
import { expandForDisplay } from '@/domain/display';
import { useCategories } from '@/data/hooks/settings';
import { useTasks, useToggleTaskDone } from '@/data/hooks/tasks';
import { formatKoreanDate } from '@/domain/calendar';
import { dDayLabel, daysUntilDue, dueUrgency } from '@/domain/task';
import { formatTimeLabel, toDateOnly, todayDateOnly } from '@/domain/time';
import { usePermissionStore } from '@/native/permissions';
import { eventColor } from '@/ui/screens/calendar/day-sheet';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

const TZ = 'Asia/Seoul';

function remainLabel(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return '지금';
  const h = Math.floor(ms / 3600_000);
  const m = Math.ceil((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}시간 ${m}분 후` : `${m}분 후`;
}

export function HomeScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const permissionBroken = usePermissionStore((s) => s.broken);

  // 1분 tick — 포커스 중에만 (stage-4 §1-5, master §6)
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      const t = setInterval(() => setNow(new Date()), 60_000);
      return () => clearInterval(t);
    }, [])
  );

  const today = todayDateOnly(TZ);
  // now는 분 단위 갱신 — range는 시간 경계로 고정해 쿼리키 폭주 방지
  const hourBucket = Math.floor(now.getTime() / 3600_000);
  const range = useMemo(() => {
    const from = new Date(hourBucket * 3600_000 - 3600_000);
    return { from, to: new Date(from.getTime() + 2 * 86400_000), tz: TZ };
  }, [hourBucket]);

  const { data: events } = useEvents(range);
  const { data: overrides } = useOverrides();
  const { data: tasks } = useTasks();
  const { data: categories } = useCategories();
  const toggleDone = useToggleTaskDone();

  const todayTimed = useMemo(() => {
    const items = expandForDisplay(events ?? [], overrides ?? [], range, TZ);
    return items
      .filter(
        (it) =>
          it.event.kind !== 'task' &&
          it.start &&
          toDateOnly(it.start, TZ) === today &&
          it.start.getTime() > now.getTime()
      )
      .map((it) => ({ ...it.event, startsAt: it.start, endsAt: it.end }))
      .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
  }, [events, overrides, range, today, now]);
  const nextEvent = todayTimed[0] ?? null;

  const openTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => !t.isDone && t.dueAt)
        .map((t) => ({ task: t, days: daysUntilDue(t.dueAt!, now, TZ) }))
        .sort((a, b) => a.days - b.days),
    [tasks, now]
  );
  const urgentTasks = openTasks.filter((t) => t.days <= 3);

  const taskCountToday = openTasks.filter((t) => t.days <= 0).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
    >
      {permissionBroken && (
        <Pressable style={styles.banner} onPress={() => router.push('/onboarding/permissions')}>
          <AppText variant="caption" color="white">
            ⚠️ 알람 권한이 해제되었습니다 — 탭해서 수정
          </AppText>
        </Pressable>
      )}

      <Animated.View entering={FadeInDown.delay(0)}>
        <AppText variant="display">{formatKoreanDate(today)}</AppText>
        <AppText variant="caption" color="textSub" nums>
          오늘 일정 {todayTimed.length}개 · 과제 {taskCountToday > 0 ? `${taskCountToday}개 마감` : `${openTasks.length}개 진행 중`}
        </AppText>
      </Animated.View>

      {/* 다음 일정 */}
      <Animated.View entering={FadeInDown.delay(40)} style={styles.section}>
        <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
          {nextEvent?.kind === 'timetable' ? '다음 수업' : '다음 일정'}
        </AppText>
        {nextEvent ? (
          <Pressable
            style={styles.nextCard}
            onPress={() => router.push({ pathname: '/event/[id]', params: { id: nextEvent.id } })}
          >
            <View
              style={[styles.nextBar, { backgroundColor: eventColor(nextEvent, categories ?? []) }]}
            />
            <View style={styles.nextBody}>
              <AppText variant="title" nums>
                {formatTimeLabel(nextEvent.startsAt!, TZ)} {nextEvent.title}
              </AppText>
              <AppText variant="caption" color="accent" nums>
                {remainLabel(nextEvent.startsAt!, now)}
                {nextEvent.location ? ` · ${nextEvent.location}` : ''}
              </AppText>
            </View>
          </Pressable>
        ) : (
          <View style={styles.card}>
            <AppText color="textSub">오늘 남은 일정이 없어요</AppText>
          </View>
        )}
      </Animated.View>

      {/* 마감 임박 */}
      {urgentTasks.length > 0 && (
        <Animated.View entering={FadeInDown.delay(80)} style={styles.section}>
          <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
            마감 임박
          </AppText>
          <View style={styles.chipWrap}>
            {urgentTasks.slice(0, 6).map(({ task, days }) => {
              const u = dueUrgency(days);
              return (
                <Pressable
                  key={task.id}
                  style={[
                    styles.dchip,
                    u === 'today' && { backgroundColor: colors.accent },
                    (u === 'overdue' || days <= 1) && u !== 'today' && { backgroundColor: colors.danger },
                  ]}
                  onPress={() => router.push({ pathname: '/event/[id]', params: { id: task.id } })}
                >
                  <AppText
                    variant="caption"
                    nums
                    color={u === 'normal' || u === 'soon' ? 'text' : 'white'}
                    style={styles.dchipText}
                  >
                    {dDayLabel(days)} {task.title}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      )}

      {/* 오늘 남은 일정 */}
      <Animated.View entering={FadeInDown.delay(120)} style={styles.section}>
        <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
          오늘 남은 일정
        </AppText>
        {todayTimed.length === 0 ? (
          <View style={styles.card}>
            <AppText color="textSub">비어 있어요</AppText>
          </View>
        ) : (
          todayTimed.slice(0, 5).map((e) => (
            <Pressable
              key={e.id}
              style={styles.rowItem}
              onPress={() => router.push({ pathname: '/event/[id]', params: { id: e.id } })}
            >
              <AppText variant="caption" color="textSub" nums style={styles.rowTime}>
                {formatTimeLabel(e.startsAt!, TZ)}
              </AppText>
              <AppText numberOfLines={1} style={styles.rowTitle}>
                {e.title}
              </AppText>
            </Pressable>
          ))
        )}
      </Animated.View>

      {/* 과제 빠른 완료 */}
      {openTasks.length > 0 && (
        <Animated.View entering={FadeInDown.delay(160)} style={styles.section}>
          <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
            과제
          </AppText>
          {openTasks.slice(0, 4).map(({ task, days }) => (
            <View key={task.id} style={styles.rowItem}>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  haptics.success();
                  toggleDone.mutate({ id: task.id, done: true });
                }}
                style={styles.checkbox}
              />
              <AppText numberOfLines={1} style={styles.rowTitle}>
                {task.title}
              </AppText>
              <AppText
                variant="caption"
                nums
                color={dueUrgency(days) === 'normal' ? 'textSub' : 'danger'}
              >
                {dDayLabel(days)}
              </AppText>
            </View>
          ))}
        </Animated.View>
      )}

      {/* 집중 시작 — Stage 6까지 비활성 */}
      <View style={[styles.focusBtn, styles.focusDisabled]}>
        <AppText color="textDim">집중 시작 (준비 중)</AppText>
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.x40 },
    banner: {
      backgroundColor: colors.danger,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      alignItems: 'center',
    },
    section: { gap: spacing.sm },
    sectionLabel: { letterSpacing: 2 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.lg,
    },
    nextCard: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.lg,
      gap: spacing.md,
    },
    nextBar: { width: 4, borderRadius: radius.full },
    nextBody: { gap: 2, flex: 1 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    dchip: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      maxWidth: '100%',
    },
    dchipText: { fontWeight: '600' },
    rowItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    rowTime: { width: 64 },
    rowTitle: { flex: 1 },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: radius.full,
      borderWidth: 1.5,
      borderColor: colors.textDim,
    },
    focusBtn: {
      borderRadius: radius.md,
      paddingVertical: spacing.lg,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    focusDisabled: { opacity: 0.5 },
  });

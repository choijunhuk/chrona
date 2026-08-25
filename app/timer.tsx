/**
 * 집중 타이머 전체화면 모달 (stage-6 §1-2).
 * 초 텍스트만 1초 갱신, 원형 프로그레스는 worklet 연속 애니메이션 — 리렌더 최소.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import {
  finishTimer,
  formatMMSS,
  pauseTimer,
  remainingMs,
  restoreTimer,
  resumeTimer,
  startTimer,
  useTimerStore,
} from '@/native/timer';
import { Button } from '@/ui/components/button';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const SIZE = 260;
const STROKE = 10;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

const PRESETS = [
  { label: '뽀모도로 25분', minutes: 25 },
  { label: '50분', minutes: 50 },
  { label: '15분', minutes: 15 },
];

export default function Timer() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string; title?: string }>();
  const timer = useTimerStore((s) => s.timer);

  const [now, setNow] = useState(() => Date.now());
  const progress = useSharedValue(0);

  useEffect(() => {
    void restoreTimer();
  }, []);

  // 초 단위 텍스트 갱신 (진행 중에만)
  useEffect(() => {
    if (!timer || timer.pausedAt !== null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timer]);

  // 진행률: 남은 시간까지 worklet 연속 애니메이션 (1초 리렌더와 무관)
  useEffect(() => {
    if (!timer) {
      progress.value = 0;
      return;
    }
    const total = timer.plannedMinutes * 60_000;
    const remain = remainingMs(timer, Date.now());
    const cur = 1 - remain / total;
    progress.value = cur;
    if (timer.pausedAt === null) {
      progress.value = withTiming(1, { duration: remain, easing: Easing.linear });
    }
  }, [timer, progress]);

  const circleProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRC * (1 - progress.value),
  }));

  // 완료 감지 → 화면 정리 (기록은 background handler가 함)
  useEffect(() => {
    if (timer && timer.pausedAt === null && remainingMs(timer, now) === 0) {
      haptics.success();
      router.back();
    }
  }, [timer, now, router]);

  const begin = (minutes: number) => {
    haptics.impact();
    void startTimer({
      minutes,
      eventId: typeof params.eventId === 'string' ? params.eventId : null,
      title: typeof params.title === 'string' ? params.title : null,
    });
  };

  const stop = () => {
    haptics.impact();
    void finishTimer(false).then(() => router.back());
  };

  if (!timer) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.x40 }]}>
        <AppText variant="display">집중 시작</AppText>
        {params.title && <AppText color="textSub">{params.title}</AppText>}
        <View style={styles.presets}>
          {PRESETS.map((p) => (
            <Button key={p.minutes} label={p.label} variant="ghost" onPress={() => begin(p.minutes)} />
          ))}
        </View>
        <Button label="닫기" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  const remain = remainingMs(timer, now);
  const paused = timer.pausedAt !== null;

  return (
    <View style={[styles.container, styles.center]}>
      <View style={styles.ring}>
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={colors.surfaceAlt}
            strokeWidth={STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={colors.accent}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            animatedProps={circleProps}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View style={styles.ringCenter}>
          <AppText nums style={styles.time}>
            {formatMMSS(remain)}
          </AppText>
          {timer.title && (
            <AppText variant="caption" color="textSub" numberOfLines={1}>
              {timer.title}
            </AppText>
          )}
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          label={paused ? '재개' : '일시정지'}
          variant="ghost"
          onPress={() => void (paused ? resumeTimer() : pauseTimer())}
          style={styles.actionBtn}
        />
        <Button label="종료" variant="danger" onPress={stop} style={styles.actionBtn} />
      </View>
      <Pressable onPress={() => router.back()} style={styles.minimize}>
        <AppText variant="caption" color="textDim">
          백그라운드로 (알림창에서 계속)
        </AppText>
      </Pressable>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: spacing.xl, gap: spacing.xl },
    center: { alignItems: 'center', justifyContent: 'center' },
    presets: { gap: spacing.md, marginTop: spacing.xl },
    ring: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
    ringCenter: { position: 'absolute', alignItems: 'center', gap: spacing.xs },
    time: { fontSize: 56, fontWeight: '700', fontFamily: 'Pretendard' },
    actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.x32 },
    actionBtn: { minWidth: 120 },
    minimize: { padding: spacing.md, borderRadius: radius.md },
  });

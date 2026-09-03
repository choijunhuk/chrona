/* eslint react-hooks/refs: "off" -- Reanimated shared value 접근은 전부 worklet(UI 스레드)에서 일어난다. render에서 읽지 않음 */
/**
 * 전체화면 알람 화면 (Stage 0 §1-6).
 *
 * 제약 — 이 화면은 네트워크·Supabase·AsyncStorage 조회를 일절 하지 않는다.
 * 렌더링에 필요한 모든 것은 라우트 파라미터(= 알림 payload)에서 온다 (마스터 §3.5).
 *
 * 조작: 밀어서 해제(슬라이드 제스처 — 오조작 방지) / 탭해서 스누즈.
 * 디자인은 Stage 8에서 폴리싱. 지금은 검은 배경 + 흰 텍스트.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { localSettingsCache } from '@/data/local-settings';
import { parseAlarmPayload } from '@/domain/alarm-payload';
import { dismissAlarm, postMissedAlarm, setAlarmRingScreenOpen, snoozeAlarm } from '@/native/alarm';
import { haptics } from '@/ui/components/haptics';
import { AlarmChallenge } from '@/ui/screens/alarm-challenge';
import { colors } from '@/ui/tokens';

const TRACK_WIDTH = 300;
const THUMB_SIZE = 64;
const SLIDE_MAX = TRACK_WIDTH - THUMB_SIZE - 8;
const DISMISS_THRESHOLD = SLIDE_MAX * 0.85;
const LONG_PRESS_MS = 1500; // 오조작 방지 — 슬라이드 제스처가 안 먹을 때의 대비책

export default function AlarmRing() {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string>>();
  const payload = parseAlarmPayload(params);
  const notificationId = typeof params.notificationId === 'string' ? params.notificationId : '';

  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const snoozeExhausted = payload.currentSnoozeCount >= payload.maxSnooze;

  // 해제 게이트 (stage-15): 챌린지가 걸린 알람은 슬라이드·길게 누르기·뒤로가기 모두
  // 곧바로 해제하지 않고 오버레이를 연다. 스누즈는 게이트 없이 그대로 쓸 수 있다.
  const challengeType = payload.challenge === 'math' || payload.challenge === 'shake' ? payload.challenge : null;
  const [challengeOpen, setChallengeOpen] = useState(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/'); // cold start(풀스크린 알람)로 진입한 경우 — /debug 로 떨어뜨리지 않는다
    }
  }, [router]);

  const onDismiss = useCallback(async () => {
    await dismissAlarm(notificationId);
    finish();
  }, [notificationId, finish]);

  /** 해제 시도 진입점 — 챌린지가 있으면 오버레이만 연다 */
  const requestDismiss = useCallback(() => {
    if (doneRef.current) return;
    haptics.selection();
    if (challengeType) {
      setChallengeOpen(true);
      return;
    }
    void onDismiss();
  }, [challengeType, onDismiss]);

  const onSnooze = useCallback(async () => {
    if (doneRef.current || snoozeExhausted) return;
    await snoozeAlarm(payload, notificationId);
    finish();
  }, [payload, notificationId, snoozeExhausted, finish]);

  // 울린 채 방치되면 자동 종료 + "놓친 알람" (stage-13 §3). 스누즈 소진 여부와 무관하다.
  // 설정은 동기 캐시로만 읽는다 — 이 화면은 AsyncStorage 조회를 하지 않는다 (master §3.5)
  useEffect(() => {
    const t = setTimeout(
      async () => {
        if (doneRef.current) return;
        await dismissAlarm(notificationId);
        await postMissedAlarm(payload);
        finish();
      },
      localSettingsCache().alarmTimeoutMinutes * 60_000
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 이 화면이 떠 있는 동안 새 알람이 와도 중복 push 하지 않도록 알린다 (master §3.9)
  useEffect(() => {
    setAlarmRingScreenOpen(true);
    return () => setAlarmRingScreenOpen(false);
  }, []);

  // 뒤로가기 = 해제(챌린지가 있으면 오버레이 열기). 기본 동작(그냥 화면 이탈)이면 알람이 계속 울린다.
  // 오버레이 안에서의 뒤로가기는 오버레이만 닫는다 — 알람은 계속 울린다
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (challengeOpen) {
        setChallengeOpen(false);
        return true;
      }
      requestDismiss();
      return true;
    });
    return () => sub.remove();
  }, [challengeOpen, requestDismiss]);

  // 밀어서 해제
  const hasChallenge = challengeType !== null;
  const translateX = useSharedValue(0);
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = Math.min(Math.max(e.translationX, 0), SLIDE_MAX);
    })
    .onEnd(() => {
      if (translateX.value >= DISMISS_THRESHOLD) {
        // 챌린지가 있으면 썸을 되돌린다 — 실패하고 돌아왔을 때 다시 밀 수 있어야 한다
        translateX.value = withSpring(hasChallenge ? 0 : SLIDE_MAX);
        runOnJS(requestDismiss)();
      } else {
        translateX.value = withSpring(0);
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <View style={[styles.accent, { backgroundColor: payload.colorHex }]} />

      <View style={styles.center}>
        <Text style={styles.time}>{payload.timeLabel}</Text>
        <Text style={styles.title}>{payload.title}</Text>
        {payload.currentSnoozeCount > 0 && (
          <Text style={styles.snoozeInfo}>
            스누즈 {payload.currentSnoozeCount}/{payload.maxSnooze}
          </Text>
        )}
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={onSnooze}
          disabled={snoozeExhausted || done}
          style={[styles.snoozeButton, (snoozeExhausted || done) && styles.disabled]}
        >
          <Text style={styles.snoozeText}>
            {snoozeExhausted ? '스누즈 소진' : `${payload.snoozeMinutes}분 뒤 다시 울림`}
          </Text>
        </Pressable>

        <View style={styles.track}>
          <Text style={styles.trackLabel}>
            {challengeType === 'math'
              ? '밀어서 문제 풀기'
              : challengeType === 'shake'
                ? '밀어서 흔들기'
                : '밀어서 해제'}
          </Text>
          <GestureDetector gesture={pan}>
            <Animated.View style={[styles.thumb, thumbStyle]}>
              <Text style={styles.thumbText}>{'>>'}</Text>
            </Animated.View>
          </GestureDetector>
        </View>

        {/* 슬라이드가 안 먹을 때의 대비책. 1.5초 길게 눌러야 동작 — 짧은 오탭으로는 안 꺼진다 */}
        <Pressable
          onLongPress={requestDismiss}
          delayLongPress={LONG_PRESS_MS}
          disabled={done}
          style={({ pressed }) => [styles.fallback, pressed && styles.fallbackPressed]}
        >
          <Text style={styles.fallbackText}>
            {challengeType ? '해제하기 (1.5초 길게 누르기)' : '해제 (1.5초 길게 누르기)'}
          </Text>
        </Pressable>
      </View>

      {challengeType && challengeOpen && (
        <AlarmChallenge
          type={challengeType}
          onSuccess={onDismiss}
          onCancel={() => setChallengeOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  accent: { height: 4, width: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  time: { color: colors.white, fontSize: 72, fontWeight: '700', fontVariant: ['tabular-nums'] },
  title: { color: colors.white, fontSize: 24, fontWeight: '500' },
  snoozeInfo: { color: colors.textSub, fontSize: 15 },
  controls: { alignItems: 'center', gap: 24, paddingBottom: 64 },
  snoozeButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disabled: { opacity: 0.35 },
  snoozeText: { color: colors.white, fontSize: 17 },
  track: {
    width: TRACK_WIDTH,
    height: THUMB_SIZE + 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  trackLabel: {
    position: 'absolute',
    alignSelf: 'center',
    color: colors.textDim,
    fontSize: 15,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 999,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: { color: colors.black, fontSize: 20, fontWeight: '700' },
  fallback: { paddingHorizontal: 16, paddingVertical: 8 },
  fallbackPressed: { opacity: 0.5 },
  fallbackText: { color: colors.textDim, fontSize: 14 },
});

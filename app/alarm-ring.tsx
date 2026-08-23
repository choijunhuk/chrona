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
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { parseAlarmPayload } from '@/domain/alarm-payload';
import { dismissAlarm, snoozeAlarm } from '@/native/alarm';

const TRACK_WIDTH = 300;
const THUMB_SIZE = 64;
const SLIDE_MAX = TRACK_WIDTH - THUMB_SIZE - 8;
const DISMISS_THRESHOLD = SLIDE_MAX * 0.85;
const AUTO_DISMISS_AFTER_MS = 60_000;

export default function AlarmRing() {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string>>();
  const payload = parseAlarmPayload(params);
  const notificationId = typeof params.notificationId === 'string' ? params.notificationId : '';

  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const snoozeExhausted = payload.currentSnoozeCount >= payload.maxSnooze;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/debug');
    }
  }, [router]);

  const onDismiss = useCallback(async () => {
    await dismissAlarm(notificationId);
    finish();
  }, [notificationId, finish]);

  const onSnooze = useCallback(async () => {
    if (doneRef.current || snoozeExhausted) return;
    await snoozeAlarm(payload, notificationId);
    finish();
  }, [payload, notificationId, snoozeExhausted, finish]);

  // 스누즈 소진 상태로 울렸는데 방치되면 자동 해제 + 놓친 알람 (마스터 §3.8)
  useEffect(() => {
    if (!snoozeExhausted) return;
    const t = setTimeout(async () => {
      if (doneRef.current) return;
      await snoozeAlarm(payload, notificationId); // count >= max → 놓친 알람 알림 + 해제
      finish();
    }, AUTO_DISMISS_AFTER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 밀어서 해제
  const translateX = useSharedValue(0);
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = Math.min(Math.max(e.translationX, 0), SLIDE_MAX);
    })
    .onEnd(() => {
      if (translateX.value >= DISMISS_THRESHOLD) {
        translateX.value = withSpring(SLIDE_MAX);
        runOnJS(onDismiss)();
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
          <Text style={styles.trackLabel}>밀어서 해제</Text>
          <GestureDetector gesture={pan}>
            <Animated.View style={[styles.thumb, thumbStyle]}>
              <Text style={styles.thumbText}>{'>>'}</Text>
            </Animated.View>
          </GestureDetector>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  accent: { height: 4, width: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  time: { color: '#FFFFFF', fontSize: 72, fontWeight: '700', fontVariant: ['tabular-nums'] },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '500' },
  snoozeInfo: { color: '#9BA1B0', fontSize: 15 },
  controls: { alignItems: 'center', gap: 24, paddingBottom: 64 },
  snoozeButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#444444',
  },
  disabled: { opacity: 0.35 },
  snoozeText: { color: '#FFFFFF', fontSize: 17 },
  track: {
    width: TRACK_WIDTH,
    height: THUMB_SIZE + 8,
    borderRadius: 999,
    backgroundColor: '#1A1A1A',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  trackLabel: {
    position: 'absolute',
    alignSelf: 'center',
    color: '#5E6473',
    fontSize: 15,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: { color: '#000000', fontSize: 20, fontWeight: '700' },
});

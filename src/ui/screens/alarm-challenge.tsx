/* eslint react-hooks/immutability: "off", react-hooks/refs: "off" -- Reanimated shared value 쓰기는 이벤트 핸들러에서만(React 상태 아님), 카운터/디바운스 ref는 effect·콜백에서만 읽고 쓴다 */
/**
 * 해제 챌린지 오버레이 (stage-15) — /alarm-ring 위에 덮인다.
 *
 * 규칙: 성공해야만 onSuccess(=해제). 취소·뒤로가기는 오버레이만 닫고 알람은 계속 울린다.
 * payload만으로 동작 — 네트워크·스토리지 조회 없음 (master §3.5).
 * 색은 정적 다크 팔레트 — 알람 화면은 테마와 무관하게 어둡다.
 */
import { Accelerometer } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { haptics } from '@/ui/components/haptics';
import { colors, radius, spacing, typography } from '@/ui/tokens';

const MATH_TOTAL = 3;
const SHAKE_TARGET = 15;
const SHAKE_DELTA_G = 1.8; // 가속도 크기 변화량(g) — 이보다 커야 1회로 센다
const SHAKE_DEBOUNCE_MS = 150; // 한 번의 흔들림이 여러 샘플로 중복 카운트되는 것 방지
const SHAKE_INTERVAL_MS = 50;

type Props = {
  type: 'math' | 'shake';
  onSuccess: () => void;
  onCancel: () => void;
};

export function AlarmChallenge({ type, onSuccess, onCancel }: Props) {
  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.kicker}>
          {type === 'math' ? '문제를 풀어야 해제됩니다' : '흔들어야 해제됩니다'}
        </Text>
        {type === 'math' ? (
          <MathChallenge onSuccess={onSuccess} />
        ) : (
          <ShakeChallenge onSuccess={onSuccess} />
        )}
      </View>
      <Pressable onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
        <Text style={styles.cancelText}>취소 (알람 계속 울림)</Text>
      </Pressable>
    </View>
  );
}

// ─── 수학 ───────────────────────────────────────────────

type Problem = { text: string; answer: number };

const rnd = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/** 두 자리 덧셈·뺄셈 또는 한 자리 × 두 자리 곱셈 (rusty-alarm MathChallenge 이식) */
function makeProblem(): Problem {
  const kind = rnd(0, 2);
  if (kind === 2) {
    const a = rnd(2, 9);
    const b = rnd(10, 99);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  const a = rnd(10, 99);
  const b = rnd(10, 99);
  if (kind === 0) return { text: `${a} + ${b}`, answer: a + b };
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return { text: `${hi} − ${lo}`, answer: hi - lo };
}

function MathChallenge({ onSuccess }: { onSuccess: () => void }) {
  const [solved, setSolved] = useState(0);
  const [problem, setProblem] = useState<Problem>(makeProblem);
  const [input, setInput] = useState('');
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const submit = () => {
    if (input.trim() === '') return;
    if (Number(input) === problem.answer) {
      const next = solved + 1;
      setInput('');
      void haptics.selection();
      if (next >= MATH_TOTAL) {
        void haptics.success();
        onSuccess();
        return;
      }
      setSolved(next);
      setProblem(makeProblem());
      return;
    }
    // 오답: 흔들림 + 경고 햅틱 + 같은 자리의 문제를 새로 낸다
    void haptics.warning();
    shake.value = withSequence(
      withTiming(-10, { duration: 45 }),
      withTiming(10, { duration: 45 }),
      withTiming(-6, { duration: 45 }),
      withTiming(0, { duration: 45 })
    );
    setInput('');
    setProblem(makeProblem());
  };

  return (
    <>
      <Text style={styles.progress}>
        {solved + 1}/{MATH_TOTAL}
      </Text>
      <Animated.View style={[styles.mathBox, shakeStyle]}>
        <Text style={styles.problem}>{problem.text}</Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          keyboardType="numeric"
          inputMode="numeric"
          placeholder="?"
          placeholderTextColor={colors.textDim}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      </Animated.View>
      <Pressable onPress={submit} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
        <Text style={styles.primaryText}>확인</Text>
      </Pressable>
    </>
  );
}

// ─── 흔들기 ─────────────────────────────────────────────

function ShakeChallenge({ onSuccess }: { onSuccess: () => void }) {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  const lastMag = useRef(0);
  const lastAt = useRef(0);
  const doneRef = useRef(false);

  const succeed = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    void haptics.success();
    onSuccess();
  }, [onSuccess]);

  // 구독은 오버레이가 떠 있는 동안만 — 알람 화면 뒤에서 센서를 돌리지 않는다
  useEffect(() => {
    Accelerometer.setUpdateInterval(SHAKE_INTERVAL_MS);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const mag = Math.sqrt(x * x + y * y + z * z);
      const prev = lastMag.current;
      lastMag.current = mag;
      if (prev === 0 || doneRef.current) return; // 첫 샘플은 기준값
      const now = Date.now();
      if (Math.abs(mag - prev) < SHAKE_DELTA_G || now - lastAt.current < SHAKE_DEBOUNCE_MS) return;
      lastAt.current = now;
      countRef.current += 1;
      setCount(countRef.current);
      if (countRef.current >= SHAKE_TARGET) succeed();
      else void haptics.selection();
    });
    return () => sub.remove();
  }, [succeed]);

  const ratio = Math.min(1, count / SHAKE_TARGET);

  return (
    <>
      <Text style={styles.progress}>
        {count}/{SHAKE_TARGET}
      </Text>
      <Text style={styles.problem}>흔들어요</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  card: { alignItems: 'center', gap: spacing.lg, width: '100%' },
  kicker: { ...typography.caption, color: colors.textSub },
  progress: {
    ...typography.micro,
    color: colors.textDim,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  mathBox: { alignItems: 'center', gap: spacing.md },
  problem: {
    ...typography.display,
    color: colors.white,
    fontSize: 44,
    fontVariant: ['tabular-nums'],
  },
  input: {
    ...typography.display,
    color: colors.white,
    fontSize: 40,
    fontVariant: ['tabular-nums'],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    minWidth: 200,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  primary: {
    backgroundColor: colors.white,
    borderRadius: radius.full,
    paddingHorizontal: spacing.x40,
    paddingVertical: spacing.md,
  },
  primaryText: { ...typography.title, color: colors.black },
  track: {
    width: '100%',
    height: 14,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  cancel: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  cancelText: { ...typography.caption, color: colors.textDim },
  pressed: { opacity: 0.6 },
});

import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius } from '@/ui/tokens';

/** 로딩 자리표시자 — 스피너 금지 (master §5.3). opacity 펄스는 UI 스레드에서. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    // ponytail: 펄스는 시각 피드백일 뿐 스프링 물리 불필요 — timing 반복이 최소 구현
    pulse.value = withRepeat(withTiming(0.9, { duration: 700 }), -1, true);
  }, [pulse]);

  const animStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, height: 16 },
        animStyle,
        style,
      ]}
    />
  );
}

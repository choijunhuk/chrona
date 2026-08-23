import { View } from 'react-native';

import { radius } from '@/ui/tokens';

/** 일정 색상 점 */
export function ColorDot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: color,
      }}
    />
  );
}

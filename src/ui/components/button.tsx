import { ActivityIndicator, Pressable, type ViewStyle } from 'react-native';

import { AppText } from '@/ui/components/text';
import { colors, radius, spacing } from '@/ui/tokens';

type Variant = 'primary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

const bg: Record<Variant, string> = {
  primary: colors.accent,
  ghost: colors.surface,
  danger: colors.danger,
};

export function Button({ label, onPress, variant = 'primary', disabled, loading, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg[variant],
          borderColor: variant === 'ghost' ? colors.border : bg[variant],
          borderWidth: 1,
          borderRadius: radius.md,
          paddingVertical: spacing.lg - 2,
          paddingHorizontal: spacing.xl,
          alignItems: 'center',
          opacity: pressed || disabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <AppText style={{ fontWeight: '600' }}>{label}</AppText>
      )}
    </Pressable>
  );
}

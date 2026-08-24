import { ActivityIndicator, Pressable, type ViewStyle } from 'react-native';

import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing } from '@/ui/tokens';

type Variant = 'primary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, variant = 'primary', disabled, loading, style }: Props) {
  const { colors } = useTheme();
  const bg = { primary: colors.accent, ghost: colors.surface, danger: colors.danger }[variant];
  const labelColor = variant === 'ghost' ? 'text' : 'white';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderColor: variant === 'ghost' ? colors.border : bg,
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
        <ActivityIndicator color={colors.white} />
      ) : (
        <AppText color={labelColor} style={{ fontWeight: '600' }}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

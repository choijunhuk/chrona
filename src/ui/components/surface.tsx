import { View, type ViewProps } from 'react-native';

import { colors, radius, spacing } from '@/ui/tokens';

type Props = ViewProps & { alt?: boolean; padded?: boolean };

/** 카드 컨테이너 */
export function Surface({ alt, padded = true, style, ...rest }: Props) {
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: alt ? colors.surfaceAlt : colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radius.md,
          padding: padded ? spacing.lg : 0,
        },
        style,
      ]}
    />
  );
}

import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { tabularNums, typography, type ColorToken, type TypographyVariant } from '@/ui/tokens';

type Props = TextProps & {
  variant?: TypographyVariant;
  color?: ColorToken;
  /** 시각/날짜 숫자 표시 시 true — tabular-nums (master §5.2) */
  nums?: boolean;
};

export function AppText({ variant = 'body', color = 'text', nums, style, ...rest }: Props) {
  const { colors } = useTheme();
  const base: TextStyle = {
    ...typography[variant],
    color: colors[color],
    ...(nums ? tabularNums : null),
  };
  return <RNText {...rest} style={[base, style]} />;
}

import { colors, palette } from './colors';
import { radius } from './radius';
import { spacing } from './spacing';
import { typography } from './typography';

export { colors, palette, type ColorToken } from './colors';
export { typography, tabularNums, type TypographyVariant } from './typography';
export { spacing } from './spacing';
export { radius } from './radius';
export { spring, springSoft, springSnappy } from './motion';

/**
 * 테마 훅 — Stage 2에서는 다크 고정, Stage 8에서 라이트 추가.
 * 컴포넌트는 색상 리터럴 대신 반드시 이 훅(또는 tokens import)을 쓴다.
 */
export function useTheme() {
  return { colors, palette, spacing, radius, typography };
}

import type { TextStyle } from 'react-native';

// master §5.2 — Pretendard Variable, 숫자는 tabular-nums
export const typography = {
  display: { fontSize: 32, fontWeight: '700', fontFamily: 'Pretendard' },
  title: { fontSize: 20, fontWeight: '600', fontFamily: 'Pretendard' },
  body: { fontSize: 15, fontWeight: '400', fontFamily: 'Pretendard' },
  caption: { fontSize: 13, fontWeight: '400', fontFamily: 'Pretendard' },
  micro: { fontSize: 11, fontWeight: '500', fontFamily: 'Pretendard' },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

/** 시각·날짜 숫자가 흔들리지 않게 (master §5.2) */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };

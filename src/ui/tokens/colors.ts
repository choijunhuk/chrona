// master §5.2 — 다크 퍼스트. 라이트 테마는 Stage 8.
export const colors = {
  bg: '#0E0F13',
  surface: '#17191F',
  surfaceAlt: '#1E2129',
  border: '#282C36',
  text: '#EDEFF5',
  textSub: '#9BA1B0',
  textDim: '#5E6473',
  accent: '#6C7BFF',
  danger: '#FF6B6B',
  success: '#5BD8A6',
  black: '#000000',
  white: '#FFFFFF',
} as const;

// 일정 색상 팔레트 8종 — 채도 낮게, 형광색 금지
export const palette = [
  '#6C7BFF',
  '#8B7BD8',
  '#D87B9E',
  '#D89B6C',
  '#C7C06B',
  '#7BC98A',
  '#6BB8C7',
  '#8A93A8',
] as const;

export type ColorToken = keyof typeof colors;

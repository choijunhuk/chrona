// master §5.2 다크 + 라이트 변형 (사용자 요청으로 Stage 2에서 당겨옴)
export const darkColors = {
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

export type ThemeColors = { [K in keyof typeof darkColors]: string };

export const lightColors: ThemeColors = {
  bg: '#F6F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF0F5',
  border: '#E2E5EC',
  text: '#191B20',
  textSub: '#616878',
  textDim: '#A3A9B7',
  accent: '#5B6AE8',
  danger: '#E05252',
  success: '#2FA97C',
  black: '#000000',
  white: '#FFFFFF',
};

/**
 * 정적 다크 팔레트 — 테마와 무관하게 어두워야 하는 곳 전용
 * (알람 화면: 한밤중 발화, debug 화면). 일반 UI는 useTheme()를 쓴다.
 */
export const colors = darkColors;

// 일정 색상 팔레트 8종 — 채도 낮게, 형광색 금지. 양 테마 공용.
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

export type ColorToken = keyof typeof darkColors;

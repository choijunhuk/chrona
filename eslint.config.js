// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*'],
  },
  {
    // 색상 리터럴 금지 — 토큰(src/ui/tokens)만 사용 (stage-2 §1-1)
    // 예외: 토큰 정의 자체, dev 전용 debug 화면
    files: ['src/ui/**/*.tsx', 'src/ui/**/*.ts', 'app/**/*.tsx'],
    ignores: ['src/ui/tokens/**', 'app/debug.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: '색상 리터럴 금지 — src/ui/tokens 를 사용하세요 (stage-2 §1-1).',
        },
      ],
    },
  },
  {
    // src/domain must stay pure TypeScript — reused as-is on web (master §2)
    files: ['src/domain/**/*.ts', 'src/domain/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react-native', 'react-native/*', 'react-native-*', 'expo', 'expo-*', '@expo/*', '@notifee/*', '@react-native-async-storage/*', '@supabase/*', '@tanstack/*', 'zustand', 'zustand/*'],
              message: 'src/domain/ must not depend on React Native or Expo (master spec §2).',
            },
          ],
        },
      ],
    },
  },
]);

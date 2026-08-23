// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*'],
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

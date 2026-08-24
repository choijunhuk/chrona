/**
 * 테마 상태 — 'dark' | 'light' | 'system'.
 * AsyncStorage에 즉시 persist (앱 시작 플래시 방지),
 * app_settings.theme 동기화는 /more에서 mutation으로 별도 수행.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { darkColors, lightColors, type ThemeColors } from '@/ui/tokens/colors';

export type ThemeMode = 'dark' | 'light' | 'system';

type ThemeState = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'dark',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'chrona.theme', storage: createJSONStorage(() => AsyncStorage) }
  )
);

function resolveColors(mode: ThemeMode, systemDark: boolean): ThemeColors {
  if (mode === 'system') return systemDark ? darkColors : lightColors;
  return mode === 'dark' ? darkColors : lightColors;
}

/** 컴포넌트에서 현재 테마 색상 획득. 색상 리터럴·정적 colors 대신 이것. */
export function useTheme(): { colors: ThemeColors; mode: ThemeMode; setMode: (m: ThemeMode) => void } {
  const { mode, setMode } = useThemeStore();
  const [systemDark, setSystemDark] = useState(Appearance.getColorScheme() !== 'light');

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemDark(colorScheme !== 'light');
    });
    return () => sub.remove();
  }, []);

  return { colors: resolveColors(mode, systemDark), mode, setMode };
}

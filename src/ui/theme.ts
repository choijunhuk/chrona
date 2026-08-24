/**
 * 테마 상태 — 'dark' | 'light' | 'system'.
 * AsyncStorage 수동 persist (zustand/middleware persist가 Hermes 프로덕션에서
 * 크래시를 유발해 제거 — ARCHITECTURE.md Stage 2 함정 참조).
 * app_settings.theme 동기화는 /more에서 mutation으로 별도 수행.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import { create } from 'zustand';

import { darkColors, lightColors, type ThemeColors } from '@/ui/tokens/colors';

export type ThemeMode = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'chrona.theme';

type ThemeState = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'dark',
  setMode: (mode) => {
    set({ mode });
    void AsyncStorage.setItem(STORAGE_KEY, mode);
  },
}));

// 앱 시작 시 1회 복원 (모듈 로드 시점 — 실패해도 기본 다크로 동작)
void AsyncStorage.getItem(STORAGE_KEY)
  .then((saved) => {
    if (saved === 'dark' || saved === 'light' || saved === 'system') {
      useThemeStore.setState({ mode: saved });
    }
  })
  .catch(() => {});

function resolveColors(mode: ThemeMode, systemDark: boolean): ThemeColors {
  if (mode === 'system') return systemDark ? darkColors : lightColors;
  return mode === 'dark' ? darkColors : lightColors;
}

/** 컴포넌트에서 현재 테마 색상 획득. 색상 리터럴·정적 colors 대신 이것. */
export function useTheme(): {
  colors: ThemeColors;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
} {
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

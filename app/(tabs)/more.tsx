import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOut } from '@/data/auth';
import { useUpdateSettings } from '@/data/hooks/settings';
import { Button } from '@/ui/components/button';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { spacing, type ThemeColors } from '@/ui/tokens';

// Stage 2: 로그아웃 + debug 진입만. 통계/브리핑/권한/백업/테마는 해당 스테이지에서 (master §8)
export default function More() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
      <AppText variant="title">더보기</AppText>

      <ThemeToggle />

      <Button label="디버그 화면" variant="ghost" onPress={() => router.push('/debug')} />
      <Button
        label="로그아웃"
        variant="danger"
        onPress={() => {
          void signOut();
        }}
      />
    </View>
  );
}

/** 다크 모드 스위치 하나 — 켜면 다크, 끄면 라이트 (사용자 피드백: 버튼 분리 별로) */
function ThemeToggle() {
  const { colors, mode, setMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const updateSettings = useUpdateSettings();
  const isDark = mode !== 'light';
  const toggle = (on: boolean) => {
    const next = on ? 'dark' : 'light';
    setMode(next);
    updateSettings.mutate({ theme: next }); // 서버 동기화 (오프라인이면 로컬만)
  };
  return (
    <View style={styles.themeRow}>
      <AppText>다크 모드</AppText>
      <Switch
        value={isDark}
        onValueChange={toggle}
        trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
        thumbColor={colors.white}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.lg },
  themeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});

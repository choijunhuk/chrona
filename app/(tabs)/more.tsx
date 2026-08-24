import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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

      <AppText variant="caption" color="textSub">
        테마
      </AppText>
      <ThemePicker />

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

function ThemePicker() {
  const { colors, mode, setMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const updateSettings = useUpdateSettings();
  const options = [
    { key: 'dark', label: '다크' },
    { key: 'light', label: '라이트' },
    { key: 'system', label: '시스템' },
  ] as const;
  return (
    <View style={styles.themeRow}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          style={[styles.themeChip, mode === o.key && styles.themeChipActive]}
          onPress={() => {
            setMode(o.key);
            // 서버 동기화 (오프라인이면 조용히 스킵 — 로컬 persist가 우선)
            updateSettings.mutate({ theme: o.key });
          }}
        >
          <AppText variant="caption" color={mode === o.key ? 'accent' : 'textSub'}>
            {o.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.lg },
  themeRow: { flexDirection: 'row', gap: spacing.sm },
  themeChip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  themeChipActive: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
});

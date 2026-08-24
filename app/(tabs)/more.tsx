import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOut } from '@/data/auth';
import { useSettings, useUpdateSettings } from '@/data/hooks/settings';
import { AppText } from '@/ui/components/text';
import { haptics } from '@/ui/components/haptics';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

// Stage 2: 테마/디버그/로그아웃만. 통계·브리핑·권한·백업은 해당 스테이지에서 (master §8)
export default function More() {
  const { colors, mode, setMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const updateSettings = useUpdateSettings();

  const { data: settings } = useSettings();
  const isDark = mode !== 'light';
  const toggleOngoing = (on: boolean) => {
    haptics.selection();
    updateSettings.mutate({ ongoingEnabled: on });
  };
  const toggleTheme = (on: boolean) => {
    const next = on ? 'dark' : 'light';
    setMode(next);
    haptics.selection();
    updateSettings.mutate({ theme: next });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl }]}>
      <AppText variant="display" style={styles.heading}>
        더보기
      </AppText>

      <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
        화면
      </AppText>
      <View style={styles.card}>
        <View style={styles.row}>
          <AppText>다크 모드</AppText>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.white}
          />
        </View>
      </View>

      <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
        알람
      </AppText>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push('/onboarding/permissions')}>
          <AppText>알람 권한 체크리스트</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
        <View style={styles.divider} />
        <View style={styles.row}>
          <AppText>오늘 일정 상시 알림</AppText>
          <Switch
            value={settings?.ongoingEnabled ?? false}
            onValueChange={toggleOngoing}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.white}
          />
        </View>
      </View>

      <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
        개발
      </AppText>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push('/debug')}>
          <AppText>디버그 화면</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
      </View>

      <View style={[styles.card, styles.logoutCard]}>
        <Pressable
          style={styles.row}
          onPress={() => {
            void signOut();
          }}
        >
          <AppText color="danger">로그아웃</AppText>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl },
    heading: { marginBottom: spacing.xxl },
    sectionLabel: { letterSpacing: 2, marginBottom: spacing.sm, marginLeft: spacing.xs },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      marginBottom: spacing.xl,
      overflow: 'hidden',
    },
    logoutCard: { marginTop: spacing.x32 },
    divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg - 2,
      minHeight: 52,
    },
  });

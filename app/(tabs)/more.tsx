import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Constants from 'expo-constants';
import { ToastAndroid } from 'react-native';

import { signOut } from '@/data/auth';
import { exportBackup, exportIcs, importBackup } from '@/data/backup';
import { hapticsEnabled, setHapticsEnabled } from '@/ui/components/haptics';
import { useSettings, useUpdateSettings } from '@/data/hooks/settings';
import { AppText } from '@/ui/components/text';
import { haptics } from '@/ui/components/haptics';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

// Stage 2: 테마/디버그/로그아웃만. 통계·브리핑·권한·백업은 해당 스테이지에서 (master §8)
export default function More() {
  const [pickingBriefing, setPickingBriefing] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(hapticsEnabled());
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
    >
      <AppText variant="display" style={styles.heading}>
        더보기
      </AppText>

      <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
        화면
      </AppText>
      <View style={styles.card}>
        <View style={styles.row}>
          <AppText>햅틱</AppText>
          <Switch
            value={hapticsOn}
            onValueChange={(v) => {
              setHapticsOn(v);
              setHapticsEnabled(v);
            }}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.white}
          />
        </View>
        <View style={styles.divider} />
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
        기록
      </AppText>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push('/stats')}>
          <AppText>통계</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          style={styles.row}
          onPress={() =>
            void exportBackup().catch((e) => ToastAndroid.show(String(e), ToastAndroid.LONG))
          }
        >
          <AppText>백업 내보내기 (JSON)</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          style={styles.row}
          onPress={() =>
            void importBackup()
              .then((r) => {
                if (r) ToastAndroid.show(`${r.restored}건 복원됨`, ToastAndroid.LONG);
              })
              .catch((e) => ToastAndroid.show(String(e), ToastAndroid.LONG))
          }
        >
          <AppText>백업 가져오기</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          style={styles.row}
          onPress={() =>
            void exportIcs().catch((e) => ToastAndroid.show(String(e), ToastAndroid.LONG))
          }
        >
          <AppText>캘린더 내보내기 (.ics)</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
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
        <Pressable style={styles.row} onPress={() => router.push('/periods')}>
          <AppText>교시 시간 편집</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
        <View style={styles.divider} />
        <View style={styles.row}>
          <AppText>잠들기 전 브리핑</AppText>
          <Switch
            value={settings?.briefingEnabled ?? true}
            onValueChange={(v) => {
              haptics.selection();
              updateSettings.mutate({ briefingEnabled: v });
            }}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.white}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <AppText>브리핑 시각</AppText>
          <Pressable onPress={() => setPickingBriefing(true)}>
            <AppText color="accent" nums>
              {settings?.briefingTime ?? '23:00'}
            </AppText>
          </Pressable>
        </View>
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

      {pickingBriefing && (
        <DateTimePicker
          value={(() => {
            const d = new Date();
            const [h, m] = (settings?.briefingTime ?? '23:00').split(':').map(Number);
            d.setHours(h, m, 0, 0);
            return d;
          })()}
          mode="time"
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            setPickingBriefing(false);
            if (e.type === 'set' && d) {
              updateSettings.mutate({
                briefingTime: `${String(d.getHours()).padStart(2, '0')}:${String(
                  d.getMinutes()
                ).padStart(2, '0')}`,
              });
            }
          }}
        />
      )}

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
      <AppText variant="micro" color="textDim" style={styles.version} nums>
        Chrona {Constants.expoConfig?.version ?? '?'}
      </AppText>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.x40 },
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
    version: { textAlign: 'center', marginTop: spacing.sm },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg - 2,
      minHeight: 52,
    },
  });

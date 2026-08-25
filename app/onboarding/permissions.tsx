/* eslint react-hooks/set-state-in-effect: "off" -- 권한 상태는 네이티브 API 비동기 조회 후 반영. 렌더 캐스케이드 아님 */
/**
 * 삼성 권한 온보딩 (master §4.1, stage-3 §1-8).
 * 1~4: API 상태 + 딥링크. 5·6: One UI가 API를 안 주므로 수동 확인 체크.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdateSettings } from '@/data/hooks/settings';
import {
  openBatterySettings,
  openExactAlarmSettings,
  openNotificationSettings,
  requestNotificationPermission,
} from '@/native/alarm';
import {
  checkPermissionHealth,
  isHealthy,
  recordPermissionCheck,
  openBatteryMenu,
  openFullScreenIntentSettings,
  readManualChecks,
  setManualCheck,
  usePermissionStore,
  type ManualChecks,
  type PermissionHealth,
} from '@/native/permissions';
import { Button } from '@/ui/components/button';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

function daysAgo(iso: string | null): string {
  if (!iso) return '미확인';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return d === 0 ? '오늘 확인함' : `마지막 확인: ${d}일 전`;
}

export default function Permissions() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const updateSettings = useUpdateSettings();
  const setBroken = usePermissionStore((s) => s.setBroken);

  const [health, setHealth] = useState<PermissionHealth | null>(null);
  const [manual, setManual] = useState<ManualChecks>({
    unusedAppSleep: null,
    autoOptimization: null,
  });

  const refresh = useCallback(async () => {
    const h = await checkPermissionHealth();
    setHealth(h);
    setBroken(!isHealthy(h));
    setManual(await readManualChecks());
    updateSettings.mutate({ permissionCheckedAt: new Date() });
    if (isHealthy(h)) void recordPermissionCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markManual = async (key: keyof ManualChecks) => {
    haptics.selection();
    setManual(await setManualCheck(key));
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
    >
      <AppText variant="display">알람 권한 설정</AppText>
      <AppText variant="caption" color="textSub" style={styles.intro}>
        삼성 기기는 배터리 최적화가 공격적이라 아래를 전부 설정하지 않으면{'\n'}
        며칠 뒤부터 알람이 조용히 울리지 않습니다.
      </AppText>

      <Card
        ok={health?.notifications ?? null}
        title="1. 알림 권한"
        desc="알람을 표시하기 위해 필요합니다."
        actionLabel={health?.notifications ? '설정 확인' : '권한 허용'}
        onAction={() => {
          void (health?.notifications ? openNotificationSettings() : requestNotificationPermission().then(refresh));
        }}
      />
      <Card
        ok={health?.exactAlarm ?? null}
        title="2. 알람 및 리마인더"
        desc="정확한 시각에 알람을 울리기 위한 시스템 권한입니다."
        actionLabel="설정 열기"
        onAction={() => void openExactAlarmSettings()}
      />
      <Card
        ok={null}
        title="3. 전체화면 알림"
        desc="잠금화면 위에 알람 화면을 띄웁니다. 설정에서 Chrona가 허용돼 있는지 확인하세요."
        actionLabel="설정 열기"
        onAction={() => void openFullScreenIntentSettings()}
      />
      <Card
        ok={health?.batteryUnrestricted ?? null}
        title="4. 배터리 제한 없음"
        desc="배터리 최적화가 켜져 있으면 Doze 모드에서 알람이 지연되거나 무시될 수 있습니다."
        actionLabel="설정 열기"
        onAction={() => void openBatterySettings()}
      />

      {/* 5·6 — 삼성 전용 함정. API 확인 불가 (master §4.1) */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <AppText style={styles.cardIcon}>{manual.unusedAppSleep ? '✅' : '⚠️'}</AppText>
          <AppText style={styles.cardTitle}>5. 미사용 앱 절전 제외</AppText>
        </View>
        <AppText variant="caption" color="textSub" style={styles.cardDesc}>
          설정 → 배터리 → 백그라운드 사용 제한 → 「절전 상태로 전환할 수 없는 앱」에
          Chrona를 추가하세요. ({daysAgo(manual.unusedAppSleep)})
        </AppText>
        <View style={styles.manualRow}>
          <Pressable style={styles.cardAction} onPress={() => void openBatteryMenu()}>
            <AppText variant="caption" color="accent">설정 열기 →</AppText>
          </Pressable>
          <Pressable style={styles.cardAction} onPress={() => void markManual('unusedAppSleep')}>
            <AppText variant="caption" color="success">직접 확인했음 ✓</AppText>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <AppText style={styles.cardIcon}>{manual.autoOptimization ? '✅' : '⚠️'}</AppText>
          <AppText style={styles.cardTitle}>6. 자동 최적화 끄기</AppText>
        </View>
        <AppText variant="caption" color="textSub" style={styles.cardDesc}>
          설정 → 디바이스 케어 → 자동 최적화(자동 재시작)를 끄세요. 켜져 있으면 재시작
          때마다 권한이 초기화될 수 있습니다. ({daysAgo(manual.autoOptimization)})
        </AppText>
        <View style={styles.manualRow}>
          <Pressable style={styles.cardAction} onPress={() => void markManual('autoOptimization')}>
            <AppText variant="caption" color="success">직접 확인했음 ✓</AppText>
          </Pressable>
        </View>
      </View>

      <Button label="상태 새로고침" variant="ghost" onPress={() => void refresh()} />
      <Button label="완료" onPress={() => router.back()} />
    </ScrollView>
  );
}

function Card({
  ok,
  title,
  desc,
  actionLabel,
  onAction,
}: {
  ok: boolean | null; // null = 수동 확인 항목
  title: string;
  desc: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.card, ok === false && styles.cardWarn]}>
      <View style={styles.cardHeader}>
        <AppText style={styles.cardIcon}>{ok === null ? '👆' : ok ? '✅' : '⚠️'}</AppText>
        <AppText style={styles.cardTitle}>{title}</AppText>
      </View>
      <AppText variant="caption" color="textSub" style={styles.cardDesc}>
        {desc}
      </AppText>
      <Pressable style={styles.cardAction} onPress={onAction}>
        <AppText variant="caption" color="accent">
          {actionLabel} →
        </AppText>
      </Pressable>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.x40 },
    intro: { lineHeight: 20, marginBottom: spacing.sm },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    cardWarn: { borderColor: colors.danger, borderWidth: 1 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardIcon: { fontSize: 16 },
    cardTitle: { fontWeight: '600' },
    cardDesc: { lineHeight: 19 },
    cardAction: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
    manualRow: { flexDirection: 'row', gap: spacing.xl },
  });

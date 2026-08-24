/** 교시 프리셋 편집 (stage-5 §1-9) — 더보기 하위 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePeriodPresets, useUpdatePeriodPreset } from '@/data/hooks/timetable';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

export default function Periods() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { data: periods } = usePeriodPresets();
  const update = useUpdatePeriodPreset();
  const [picking, setPicking] = useState<{ id: string; field: 'start' | 'end'; other: string } | null>(null);

  const onPick = (e: DateTimePickerEvent, d?: Date) => {
    const target = picking;
    setPicking(null);
    if (e.type !== 'set' || !d || !target) return;
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    update.mutate({
      id: target.id,
      startTime: target.field === 'start' ? hhmm : target.other,
      endTime: target.field === 'end' ? hhmm : target.other,
    });
  };

  const pickerValue = new Date();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
    >
      <AppText variant="display">교시 시간</AppText>
      <AppText variant="caption" color="textSub">
        시간표 격자의 세로축. 학교 시간에 맞게 수정하세요.
      </AppText>
      {(periods ?? []).map((p) => (
        <View key={p.id} style={styles.row}>
          <AppText nums style={styles.no}>
            {p.periodNo}교시
          </AppText>
          <Pressable
            style={styles.timeBtn}
            onPress={() => setPicking({ id: p.id, field: 'start', other: p.endTime })}
          >
            <AppText nums>{p.startTime}</AppText>
          </Pressable>
          <AppText color="textDim">~</AppText>
          <Pressable
            style={styles.timeBtn}
            onPress={() => setPicking({ id: p.id, field: 'end', other: p.startTime })}
          >
            <AppText nums>{p.endTime}</AppText>
          </Pressable>
        </View>
      ))}
      {picking && <DateTimePicker value={pickerValue} mode="time" onChange={onPick} />}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.x40 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.lg,
    },
    no: { width: 56 },
    timeBtn: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
  });

/** 순수 알람 탭 — 시계 앱 스타일 (stage-3 §1-6) */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useCreateAlarm,
  useDeleteAlarm,
  useStandaloneAlarms,
  useToggleAlarm,
} from '@/data/hooks/alarms';
import { expandStandaloneAlarms } from '@/domain/schedule';
import type { StandaloneAlarm } from '@/domain/types';
import { Button } from '@/ui/components/button';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

const TZ = 'Asia/Seoul';
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토']; // DB 규약: 0=일

function nextFireLabel(alarms: StandaloneAlarm[]): string | null {
  const now = new Date();
  const fires = expandStandaloneAlarms(
    alarms,
    now,
    new Date(now.getTime() + 8 * 86400_000),
    TZ
  ).sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  if (!fires.length) return null;
  const ms = fires[0].fireAt.getTime() - now.getTime();
  const h = Math.floor(ms / 3600_000);
  const m = Math.ceil((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}시간 ${m}분 후` : `${m}분 후`;
}

function weekdaysLabel(weekdays: number[]): string {
  if (weekdays.length === 0) return '1회성';
  if ([1, 2, 3, 4, 5].every((d) => weekdays.includes(d)) && weekdays.length === 5) return '평일';
  if (weekdays.length === 7) return '매일';
  return [...weekdays].sort().map((d) => WEEKDAY_KO[d]).join(' ');
}

export function AlarmsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { data: alarms } = useStandaloneAlarms();
  const toggleAlarm = useToggleAlarm();
  const deleteAlarm = useDeleteAlarm();
  const [adding, setAdding] = useState(false);

  const next = useMemo(() => nextFireLabel((alarms ?? []).filter((a) => a.enabled)), [alarms]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.header}>
        <View>
          <AppText variant="display">알람</AppText>
          {next && (
            <AppText variant="caption" color="accent" nums>
              다음 알람 {next}
            </AppText>
          )}
        </View>
        <Pressable onPress={() => setAdding(true)} hitSlop={8}>
          <AppText variant="title" color="accent">
            ＋
          </AppText>
        </Pressable>
      </View>

      {adding && <AlarmForm onDone={() => setAdding(false)} />}

      <FlatList
        data={alarms ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          adding ? null : (
            <View style={styles.empty}>
              <AppText color="textDim">알람이 없습니다</AppText>
              <Button label="알람 추가" variant="ghost" onPress={() => setAdding(true)} />
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.card, !item.enabled && styles.cardOff]}>
            <View style={styles.cardBody}>
              <AppText nums style={styles.time}>
                {item.time}
              </AppText>
              <AppText variant="caption" color="textSub">
                {weekdaysLabel(item.weekdays)}
                {item.label ? ` · ${item.label}` : ''}
              </AppText>
            </View>
            <Switch
              value={item.enabled}
              onValueChange={(v) => {
                haptics.selection();
                toggleAlarm.mutate({ id: item.id, enabled: v });
              }}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.white}
            />
            <Pressable
              hitSlop={8}
              style={styles.delete}
              onPress={() =>
                // 실수 탭으로 알람이 사라지면 다음 날 아침에야 알게 된다
                Alert.alert('알람 삭제', `${item.time} 알람을 삭제할까요?`, [
                  { text: '취소', style: 'cancel' },
                  {
                    text: '삭제',
                    style: 'destructive',
                    onPress: () => deleteAlarm.mutate(item.id),
                  },
                ])
              }
            >
              <AppText color="textDim">✕</AppText>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

function AlarmForm({ onDone }: { onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const createAlarm = useCreateAlarm();
  const [time, setTime] = useState('07:00');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [label, setLabel] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  const onPick = (e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) {
      setTime(
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      );
    }
  };

  const save = async () => {
    try {
      await createAlarm.mutateAsync({
        time,
        weekdays,
        label: label.trim() || null,
        enabled: true,
        soundKey: 'default',
        vibrate: true,
      });
      haptics.success();
      onDone();
    } catch {
      /* 오프라인 토스트는 가드가 처리 */
    }
  };

  const pickerValue = new Date();
  pickerValue.setHours(Number(time.slice(0, 2)), Number(time.slice(3)), 0, 0);

  return (
    <View style={styles.form}>
      <Pressable onPress={() => setShowPicker(true)}>
        <AppText nums style={styles.formTime}>
          {time}
        </AppText>
      </Pressable>
      <View style={styles.weekdayRow}>
        {WEEKDAY_KO.map((w, i) => (
          <Pressable
            key={i}
            style={[styles.weekdayChip, weekdays.includes(i) && styles.weekdayOn]}
            onPress={() =>
              setWeekdays((ws) => (ws.includes(i) ? ws.filter((x) => x !== i) : [...ws, i]))
            }
          >
            <AppText variant="caption" color={weekdays.includes(i) ? 'white' : 'textSub'}>
              {w}
            </AppText>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="라벨 (선택)"
        placeholderTextColor={colors.textDim}
      />
      <View style={styles.formActions}>
        <Button label="취소" variant="ghost" onPress={onDone} style={styles.formBtn} />
        <Button label="추가" onPress={save} loading={createAlarm.isPending} style={styles.formBtn} />
      </View>
      {showPicker && <DateTimePicker value={pickerValue} mode="time" onChange={onPick} />}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: spacing.xxl,
    },
    list: { gap: spacing.md, paddingBottom: spacing.x40 },
    empty: { alignItems: 'center', gap: spacing.lg, paddingTop: spacing.x40 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.lg,
      gap: spacing.md,
    },
    cardOff: { opacity: 0.5 },
    cardBody: { flex: 1, gap: 2 },
    time: { fontSize: 28, fontWeight: '600', fontFamily: 'Pretendard' },
    delete: { paddingLeft: spacing.sm },
    form: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.lg,
      gap: spacing.lg,
      marginBottom: spacing.lg,
      borderColor: colors.accent,
      borderWidth: 1,
    },
    formTime: { fontSize: 40, fontWeight: '700', textAlign: 'center', fontFamily: 'Pretendard' },
    weekdayRow: { flexDirection: 'row', justifyContent: 'space-between' },
    weekdayChip: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      borderColor: colors.border,
      borderWidth: 1,
    },
    weekdayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    input: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      color: colors.text,
      fontSize: 15,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    formActions: { flexDirection: 'row', gap: spacing.md },
    formBtn: { flex: 1 },
  });

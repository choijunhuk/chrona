/** 순수 알람 탭 — 시계 앱 스타일 (stage-3 §1-6) */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useCreateAlarm,
  useDeleteAlarm,
  useRestoreAlarm,
  useStandaloneAlarms,
  useToggleAlarm,
  useUpdateAlarm,
} from '@/data/hooks/alarms';
import { getLocalSettings, setLocalSettings } from '@/data/local-settings';
import { expandStandaloneAlarms } from '@/domain/schedule';
import { soundLabel } from '@/native/alarm';
import { rescheduleDebounced } from '@/native/rescheduler';
import type { ChallengeType, StandaloneAlarm } from '@/domain/types';
import { Button } from '@/ui/components/button';
import { haptics } from '@/ui/components/haptics';
import { SoundPicker } from '@/ui/components/sound-picker';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { showUndo } from '@/ui/undo-store';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

const TZ = 'Asia/Seoul';
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토']; // DB 규약: 0=일

const CHALLENGES: { value: ChallengeType; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'math', label: '수학 문제' },
  { value: 'shake', label: '흔들기 15회' },
];

/**
 * 기상 프리셋 (stage-15) — rusty-alarm WakeupPresetApplier의 의미를 Chrona 필드로 옮긴 것.
 * 알람 자체 필드(게이트·진동)와 기기 전역(local-settings)을 한 번에 맞춘다.
 * 스누즈 제한은 전역(app_settings)이라 프리셋이 건드리지 않는다 — 더보기에서 조정.
 */
const PRESETS = [
  {
    key: 'comfortable',
    label: '편안한 기상',
    desc: '예고 알림과 점진적 볼륨으로 부드럽게 깨워요.',
    challenge: 'none' as ChallengeType,
    preAlarm: 15,
    gradualVolume: true,
    minVolume: 0,
  },
  {
    key: 'onTime',
    label: '지각 방지',
    desc: '흔들기 게이트로 다시 눕는 걸 막아요.',
    challenge: 'shake' as ChallengeType,
    preAlarm: 10,
    gradualVolume: false,
    minVolume: 0,
  },
  {
    key: 'forced',
    label: '강제 기상',
    desc: '수학 문제 + 큰 볼륨으로 확실히 깨워요.',
    challenge: 'math' as ChallengeType,
    preAlarm: 10,
    gradualVolume: true,
    minVolume: 85,
  },
] as const;

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
  const restoreAlarm = useRestoreAlarm();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StandaloneAlarm | null>(null);

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
        <Pressable
          onPress={() => {
            setEditing(null);
            setAdding(true);
          }}
          hitSlop={8}
        >
          <AppText variant="title" color="accent">
            ＋
          </AppText>
        </Pressable>
      </View>

      {(adding || editing) && (
        <AlarmForm
          key={editing?.id ?? 'new'}
          initial={editing ?? undefined}
          onDone={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      <FlatList
        data={alarms ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          adding || editing ? null : (
            <View style={styles.empty}>
              <AppText color="textDim">알람이 없습니다</AppText>
              <Button label="알람 추가" variant="ghost" onPress={() => setAdding(true)} />
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.card, !item.enabled && styles.cardOff]}>
            {/* 카드 본문 탭 = 편집 (스위치·삭제 버튼은 각자 hitSlop을 가진다) */}
            <Pressable
              style={styles.cardBody}
              onPress={() => {
                haptics.selection();
                setAdding(false);
                setEditing(item);
              }}
            >
              <AppText nums style={styles.time}>
                {item.time}
              </AppText>
              <AppText variant="caption" color="textSub">
                {weekdaysLabel(item.weekdays)}
                {item.label ? ` · ${item.label}` : ''}
                {item.challenge !== 'none'
                  ? ` · ${item.challenge === 'math' ? '수학 문제' : '흔들기'}`
                  : ''}
              </AppText>
            </Pressable>
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
                    onPress: () =>
                      deleteAlarm.mutate(item.id, {
                        onSuccess: () =>
                          showUndo(`${item.time} 알람 삭제됨`, () =>
                            restoreAlarm.mutate(item.id)
                          ),
                      }),
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

function AlarmForm({ initial, onDone }: { initial?: StandaloneAlarm; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const createAlarm = useCreateAlarm();
  const updateAlarm = useUpdateAlarm();
  const [time, setTime] = useState(initial?.time ?? '07:00');
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [soundKey, setSoundKey] = useState(initial?.soundKey ?? 'default');
  const [vibrate, setVibrate] = useState(initial?.vibrate ?? true);
  const [challenge, setChallenge] = useState<ChallengeType>(initial?.challenge ?? 'none');
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [pickingSound, setPickingSound] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  /** 프리셋: 폼 상태 + 기기 전역 설정을 함께 맞춘다. 이미 켜둔 값은 낮추지 않는다 */
  const applyPreset = (p: (typeof PRESETS)[number]) => {
    haptics.selection();
    setPresetKey(p.key);
    setChallenge(p.challenge);
    setVibrate(true);
    void getLocalSettings()
      .then((s) =>
        setLocalSettings({
          gradualVolume: p.gradualVolume || s.gradualVolume,
          alarmVolumePercent: Math.max(s.alarmVolumePercent, p.minVolume),
          preAlarmMinutes: s.preAlarmMinutes === 0 ? p.preAlarm : s.preAlarmMinutes,
        })
      )
      .then(() => rescheduleDebounced());
  };

  const onPick = (e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) {
      setTime(
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      );
    }
  };

  const save = async () => {
    const fields = {
      time,
      weekdays,
      label: label.trim() || null,
      soundKey,
      vibrate,
      challenge,
    };
    try {
      if (initial) {
        await updateAlarm.mutateAsync({ id: initial.id, patch: fields });
      } else {
        await createAlarm.mutateAsync({ ...fields, enabled: true });
      }
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
      <Pressable style={styles.soundRow} onPress={() => setPickingSound(true)}>
        <AppText color="textSub">알람음</AppText>
        <AppText color="accent">{soundLabel(soundKey)}</AppText>
      </Pressable>
      <SoundPicker
        visible={pickingSound}
        value={soundKey}
        onPick={setSoundKey}
        onClose={() => setPickingSound(false)}
      />
      <View style={styles.soundRow}>
        <AppText color="textSub">진동</AppText>
        <Switch
          value={vibrate}
          onValueChange={setVibrate}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.white}
        />
      </View>

      <View style={styles.fieldGroup}>
        <AppText variant="caption" color="textSub">
          해제 방법
        </AppText>
        <View style={styles.chipRow}>
          {CHALLENGES.map((c) => (
            <Pressable
              key={c.value}
              style={[styles.chip, challenge === c.value && styles.chipOn]}
              onPress={() => {
                haptics.selection();
                setChallenge(c.value);
              }}
            >
              <AppText variant="caption" color={challenge === c.value ? 'white' : 'textSub'}>
                {c.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <AppText variant="caption" color="textSub">
          기상 프리셋
        </AppText>
        <View style={styles.chipRow}>
          {PRESETS.map((p) => (
            <Pressable
              key={p.key}
              style={[styles.chip, presetKey === p.key && styles.chipOn]}
              onPress={() => applyPreset(p)}
            >
              <AppText variant="caption" color={presetKey === p.key ? 'white' : 'textSub'}>
                {p.label}
              </AppText>
            </Pressable>
          ))}
        </View>
        <AppText variant="micro" color="textDim">
          {PRESETS.find((p) => p.key === presetKey)?.desc ??
            '고르면 해제 방법·진동·예고 알림을 한 번에 맞춰요.'}
        </AppText>
      </View>

      <View style={styles.formActions}>
        <Button label="취소" variant="ghost" onPress={onDone} style={styles.formBtn} />
        <Button
          label={initial ? '저장' : '추가'}
          onPress={save}
          loading={createAlarm.isPending || updateAlarm.isPending}
          style={styles.formBtn}
        />
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
    soundRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
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
    fieldGroup: { gap: spacing.sm },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      borderColor: colors.border,
      borderWidth: 1,
    },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
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

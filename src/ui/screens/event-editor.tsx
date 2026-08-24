/**
 * 일정 상세/편집 (stage-2 §1-7). id === 'new'면 생성 모드.
 * 종일 토글 ON → 시각 필드가 날짜 필드로 전환 (master §7.2를 UI에서 강제).
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCreateEvent, useDeleteEvent, useEvent, useUpdateEvent } from '@/data/hooks/events';
import { useReminders, useSaveReminders } from '@/data/hooks/reminders';
import { useCategories, useSettings } from '@/data/hooks/settings';
import type { EventDraft, ReminderDraft } from '@/data/mappers';
import { applicableTaskSteps } from '@/domain/task';
import { asDateOnly, formatTimeLabel, fromDateOnly, isDateOnly, toDateOnly } from '@/domain/time';
import { Button } from '@/ui/components/button';
import { ColorDot } from '@/ui/components/color-dot';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { palette, radius, spacing, type ThemeColors } from '@/ui/tokens';

const TZ = 'Asia/Seoul';

type PickerTarget = 'startDate' | 'startTime' | 'endDate' | 'endTime' | null;

type FormInitial = {
  kind: 'schedule' | 'task';
  isDone: boolean;
  title: string;
  memo: string;
  location: string;
  allDay: boolean;
  startsAt: Date;
  endsAt: Date;
  categoryId: string | null;
  color: string | null;
  reminders: ReminderDraft[];
};

const OFFSET_PRESETS = [
  { label: '정시', minutes: 0 },
  { label: '5분 전', minutes: 5 },
  { label: '10분 전', minutes: 10 },
  { label: '30분 전', minutes: 30 },
  { label: '1시간 전', minutes: 60 },
  { label: '1일 전', minutes: 1440 },
] as const;

function offsetLabel(minutes: number): string {
  const preset = OFFSET_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes % 1440 === 0) return `${minutes / 1440}일 전`;
  if (minutes % 60 === 0) return `${minutes / 60}시간 전`;
  return `${minutes}분 전`;
}

/** 라우트 래퍼: 데이터 준비 후 폼을 초기값과 함께 마운트 (effect 내 setState 회피) */
export function EventEditor() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const params = useLocalSearchParams<{ id: string; date?: string }>();
  const isNew = params.id === 'new';
  const existing = useEvent(isNew ? '' : params.id);
  const existingReminders = useReminders(isNew ? null : params.id);
  const { data: settings } = useSettings();

  const baseDate =
    params.date && isDateOnly(params.date) ? params.date : toDateOnly(new Date(), TZ);
  const defaultStart = fromDateOnly(asDateOnly(baseDate), TZ);
  defaultStart.setHours(9, 0, 0, 0);
  const defaultEnd = fromDateOnly(asDateOnly(baseDate), TZ);
  defaultEnd.setHours(10, 0, 0, 0);

  if (!isNew && (!existing.data || existingReminders.isPending)) {
    return <View style={styles.container} />;
  }

  const e = existing.data;
  const initial: FormInitial =
    !isNew && e
      ? {
          kind: e.kind === 'task' ? ('task' as const) : ('schedule' as const),
          isDone: e.isDone,
          title: e.title,
          memo: e.memo ?? '',
          location: e.location ?? '',
          allDay: e.allDay,
          startsAt:
            e.kind === 'task'
              ? (e.dueAt ?? defaultStart)
              : e.allDay && e.startDate
                ? fromDateOnly(e.startDate, TZ)
                : (e.startsAt ?? defaultStart),
          endsAt:
            e.allDay && e.startDate
              ? fromDateOnly(e.endDate ?? e.startDate, TZ)
              : (e.endsAt ?? defaultEnd),
          categoryId: e.categoryId,
          color: e.color,
          reminders: (existingReminders.data ?? []).map((r) => ({
            offsetMinutes: r.offsetMinutes,
            mode: r.mode,
            soundKey: r.soundKey,
            vibrate: r.vibrate,
            enabled: r.enabled,
          })),
        }
      : {
          kind: 'schedule' as const,
          isDone: false,
          title: '',
          memo: '',
          location: '',
          allDay: false,
          startsAt: defaultStart,
          endsAt: defaultEnd,
          categoryId: null,
          color: null,
          // 새 일정: 기본 알림 자동 부착 (사용자 확정: 10분 전)
          reminders: [
            {
              offsetMinutes: settings?.defaultReminderOffset ?? 10,
              mode: 'notify' as const,
              soundKey: settings?.defaultSoundKey ?? 'default',
              vibrate: true,
              enabled: true,
            },
          ],
        };

  return <EventForm key={params.id} id={params.id} isNew={isNew} initial={initial} />;
}

function EventForm({ id, isNew, initial }: { id: string; isNew: boolean; initial: FormInitial }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: categories } = useCategories();
  const createMutation = useCreateEvent();
  const updateMutation = useUpdateEvent();
  const deleteMutation = useDeleteEvent();

  const [title, setTitle] = useState(initial.title);
  const [memo, setMemo] = useState(initial.memo);
  const [location, setLocation] = useState(initial.location);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startsAt, setStartsAt] = useState<Date>(initial.startsAt);
  const [endsAt, setEndsAt] = useState<Date>(initial.endsAt);
  const [categoryId, setCategoryId] = useState<string | null>(initial.categoryId);
  const [color, setColor] = useState<string | null>(initial.color);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [kind, setKind] = useState<'schedule' | 'task'>(initial.kind);
  const [isDone, setIsDone] = useState(initial.isDone);
  const [reminders, setReminders] = useState<ReminderDraft[]>(initial.reminders);

  // 과제 모드 전환 시 계단식 알림 자동 세팅 (지난 단계 스킵 — stage-4 §1-2)
  const switchKind = (k: 'schedule' | 'task') => {
    if (!isNew) return; // 생성 시에만 전환 가능 (stage-4 §1-3)
    setKind(k);
    if (k === 'task') {
      setReminders(
        applicableTaskSteps(startsAt, new Date()).map((st) => ({
          offsetMinutes: st.offsetMinutes,
          mode: 'notify' as const,
          soundKey: 'default',
          vibrate: true,
          enabled: true,
        }))
      );
    } else {
      setReminders(initial.reminders);
    }
  };
  const [showPresets, setShowPresets] = useState(false);
  const saveReminders = useSaveReminders();

  const buildDraft = (): EventDraft => {
    if (kind === 'task') {
      return {
        kind: 'task',
        title: title.trim() || '(제목 없음)',
        memo: memo.trim() || null,
        categoryId,
        color,
        allDay: false,
        startsAt: null,
        endsAt: null,
        startDate: null,
        endDate: null,
        rrule: null,
        rruleUntil: null,
        dueAt: startsAt, // 과제는 startsAt state를 마감으로 사용
        isDone,
        doneAt: isDone ? new Date() : null,
        semesterId: null,
        location: null,
        professor: null,
      };
    }
    return {
      kind: 'schedule',
      title: title.trim() || '(제목 없음)',
      memo: memo.trim() || null,
      categoryId,
      color,
      allDay,
      // §7.2: 종일이면 date만, 아니면 timestamp만
      startsAt: allDay ? null : startsAt,
      endsAt: allDay ? null : endsAt,
      startDate: allDay ? toDateOnly(startsAt, TZ) : null,
      endDate: allDay ? toDateOnly(endsAt, TZ) : null,
      rrule: null,
      rruleUntil: null,
      dueAt: null,
      isDone: false,
      doneAt: null,
      semesterId: null,
      location: location.trim() || null,
      professor: null,
    };
  };

  const save = async () => {
    try {
      let eventId = id;
      if (isNew) {
        const created = await createMutation.mutateAsync(buildDraft());
        eventId = created.id;
      } else {
        await updateMutation.mutateAsync({ id, draft: buildDraft() });
      }
      await saveReminders.mutateAsync({ eventId, drafts: reminders });
      haptics.success();
      router.back();
    } catch (e) {
      // 실패를 절대 조용히 삼키지 않는다 (오프라인 토스트는 assertOnline이 별도 표출)
      console.warn('[chrona] save failed:', e);
      if (String(e) !== 'Error: offline') {
        ToastAndroid.show(`저장 실패: ${String(e)}`, ToastAndroid.LONG);
      }
    }
  };

  const remove = () => {
    Alert.alert('일정 삭제', '이 일정을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMutation.mutateAsync(id);
            haptics.impact();
            router.back();
          } catch {
            /* 오프라인 안내는 가드가 처리 */
          }
        },
      },
    ]);
  };

  const onPickerChange = (event: DateTimePickerEvent, date?: Date) => {
    const target = picker;
    setPicker(null);
    if (event.type !== 'set' || !date || !target) return;
    const apply = (base: Date, mode: 'date' | 'time') => {
      const next = new Date(base);
      if (mode === 'date') next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      else next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      return next;
    };
    if (target === 'startDate') setStartsAt((p) => apply(p, 'date'));
    if (target === 'startTime') setStartsAt((p) => apply(p, 'time'));
    if (target === 'endDate') setEndsAt((p) => apply(p, 'date'));
    if (target === 'endTime') setEndsAt((p) => apply(p, 'time'));
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
    >
      <AppText variant="title">
        {isNew ? '새로 만들기' : kind === 'task' ? '과제 편집' : '일정 편집'}
      </AppText>

      {isNew && (
        <View style={styles.kindRow}>
          {(['schedule', 'task'] as const).map((k) => (
            <Pressable
              key={k}
              style={[styles.kindChip, kind === k && styles.kindChipOn]}
              onPress={() => switchKind(k)}
            >
              <AppText variant="caption" color={kind === k ? 'white' : 'textSub'}>
                {k === 'schedule' ? '일정' : '과제'}
              </AppText>
            </Pressable>
          ))}
        </View>
      )}

      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="제목"
        placeholderTextColor={colors.textDim}
      />

      {kind === 'schedule' && (
        <View style={styles.rowBetween}>
          <AppText>종일</AppText>
          <Switch
            value={allDay}
            onValueChange={setAllDay}
            trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>
      )}

      {/* 시각 필드 ↔ 날짜 필드 전환 (§7.2 UI 강제) */}
      <View style={styles.rowBetween}>
        <AppText color="textSub">{kind === 'task' ? '마감' : '시작'}</AppText>
        <View style={styles.pickerRow}>
          <Pressable style={styles.pickerBtn} onPress={() => setPicker('startDate')}>
            <AppText nums>{toDateOnly(startsAt, TZ)}</AppText>
          </Pressable>
          {!allDay && (
            <Pressable style={styles.pickerBtn} onPress={() => setPicker('startTime')}>
              <AppText nums>{formatTimeLabel(startsAt, TZ)}</AppText>
            </Pressable>
          )}
        </View>
      </View>
      {kind === 'task' && !isNew && (
        <View style={styles.rowBetween}>
          <AppText>완료</AppText>
          <Switch
            value={isDone}
            onValueChange={setIsDone}
            trackColor={{ true: colors.success, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>
      )}
      {kind === 'schedule' && (
      <View style={styles.rowBetween}>
        <AppText color="textSub">종료</AppText>
        <View style={styles.pickerRow}>
          <Pressable style={styles.pickerBtn} onPress={() => setPicker('endDate')}>
            <AppText nums>{toDateOnly(endsAt, TZ)}</AppText>
          </Pressable>
          {!allDay && (
            <Pressable style={styles.pickerBtn} onPress={() => setPicker('endTime')}>
              <AppText nums>{formatTimeLabel(endsAt, TZ)}</AppText>
            </Pressable>
          )}
        </View>
      </View>
      )}

      {/* 알림 (stage-3 §1-5) */}
      <AppText variant="caption" color="textSub">
        알림
      </AppText>
      {reminders.map((r, i) => (
        <View key={i} style={[styles.reminderRow, r.mode === 'alarm' && styles.reminderAlarm]}>
          <AppText nums style={styles.reminderLabel}>
            {r.mode === 'alarm' ? '⏰ ' : ''}
            {offsetLabel(r.offsetMinutes)}
          </AppText>
          <Pressable
            style={[styles.modeChip, r.mode === 'alarm' && styles.modeChipAlarm]}
            onPress={() =>
              setReminders((rs) =>
                rs.map((x, j) =>
                  j === i ? { ...x, mode: x.mode === 'alarm' ? 'notify' : 'alarm' } : x
                )
              )
            }
          >
            <AppText variant="caption" color={r.mode === 'alarm' ? 'white' : 'textSub'}>
              {r.mode === 'alarm' ? '알람' : '알림'}
            </AppText>
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => setReminders((rs) => rs.filter((_, j) => j !== i))}
          >
            <AppText color="textDim">✕</AppText>
          </Pressable>
        </View>
      ))}
      {showPresets ? (
        <View style={styles.chipRow}>
          {OFFSET_PRESETS.map((p) => (
            <Pressable
              key={p.minutes}
              style={styles.chip}
              onPress={() => {
                setReminders((rs) => [
                  ...rs,
                  {
                    offsetMinutes: p.minutes,
                    mode: 'notify',
                    soundKey: 'default',
                    vibrate: true,
                    enabled: true,
                  },
                ]);
                setShowPresets(false);
              }}
            >
              <AppText variant="caption">{p.label}</AppText>
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable onPress={() => setShowPresets(true)}>
          <AppText variant="caption" color="accent">
            + 알림 추가
          </AppText>
        </Pressable>
      )}

      {/* 카테고리 */}
      <AppText variant="caption" color="textSub">
        카테고리
      </AppText>
      <View style={styles.chipRow}>
        {(categories ?? []).map((c) => (
          <Pressable
            key={c.id}
            style={[styles.chip, categoryId === c.id && styles.chipActive]}
            onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
          >
            <ColorDot color={c.color} size={8} />
            <AppText variant="caption">{c.name}</AppText>
          </Pressable>
        ))}
      </View>

      {/* 색상 (미지정 시 카테고리 색 상속) */}
      <AppText variant="caption" color="textSub">
        색상
      </AppText>
      <View style={styles.chipRow}>
        {palette.map((p) => (
          <Pressable
            key={p}
            onPress={() => setColor(color === p ? null : p)}
            style={[styles.swatch, { backgroundColor: p }, color === p && styles.swatchActive]}
          />
        ))}
      </View>

      {kind === 'schedule' && (
        <TextInput
          style={styles.input}
          value={location}
          onChangeText={setLocation}
          placeholder="장소"
          placeholderTextColor={colors.textDim}
        />
      )}
      <TextInput
        style={[styles.input, styles.memo]}
        value={memo}
        onChangeText={setMemo}
        placeholder="메모"
        placeholderTextColor={colors.textDim}
        multiline
      />

      <Button label={isNew ? '만들기' : '저장'} onPress={save} loading={saving} />
      {!isNew && <Button label="삭제" variant="danger" onPress={remove} />}
      <Button label="취소" variant="ghost" onPress={() => router.back()} />

      {picker && (
        <DateTimePicker
          value={picker.startsWith('start') ? startsAt : endsAt}
          mode={picker.endsWith('Date') ? 'date' : 'time'}
          onChange={onPickerChange}
        />
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.x40 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  memo: { minHeight: 80, textAlignVertical: 'top' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerRow: { flexDirection: 'row', gap: spacing.sm },
  pickerBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kindChip: {
    flex: 1,
    alignItems: 'center',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  kindChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // 알람 모드는 시각적으로 강조 — 실수로 켜면 새벽에 울린다 (stage-3 §1-5)
  reminderAlarm: { borderColor: colors.accent, backgroundColor: `${colors.accent}14` },
  reminderLabel: { flex: 1 },
  modeChip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  modeChipAlarm: { backgroundColor: colors.accent, borderColor: colors.accent },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  swatch: { width: 28, height: 28, borderRadius: radius.full },
  swatchActive: { borderWidth: 2, borderColor: colors.text },
});

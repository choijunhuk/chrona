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
import {
  describeRepeat,
  fromRRuleString,
  toRRuleString,
  type RepeatConfig,
} from '@/domain/rrule-ui';
import { useUpsertOverride } from '@/data/hooks/overrides';
import { SOUND_OPTIONS, soundLabel } from '@/native/alarm';
import { asDateOnly, formatTimeLabel, fromDateOnly, isDateOnly, toDateOnly } from '@/domain/time';
import { Button } from '@/ui/components/button';
import { ColorDot } from '@/ui/components/color-dot';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { palette, radius, spacing, type ThemeColors } from '@/ui/tokens';

const TZ = 'Asia/Seoul';

type PickerTarget = 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'untilDate' | null;

type EditorKind = 'schedule' | 'task' | 'timetable';

type FormInitial = {
  kind: EditorKind;
  isDone: boolean;
  repeat: RepeatConfig | 'custom';
  rruleRaw: string | null;
  untilDate: Date | null;
  title: string;
  memo: string;
  location: string;
  /** timetable 전용 — 편집해도 kind가 바뀌지 않게 함께 보존 */
  professor: string;
  semesterId: string | null;
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
  const params = useLocalSearchParams<{ id: string; date?: string; occ?: string }>();
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
          // ★ timetable을 schedule로 접지 않는다 — 접으면 semester_id가 지워져 격자에서 사라진다
          kind: (e.kind === 'task' || e.kind === 'timetable' ? e.kind : 'schedule') as EditorKind,
          isDone: e.isDone,
          repeat: fromRRuleString(e.rrule),
          rruleRaw: e.rrule,
          untilDate: e.rruleUntil,
          title: e.title,
          memo: e.memo ?? '',
          location: e.location ?? '',
          professor: e.professor ?? '',
          semesterId: e.semesterId,
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
          repeat: { freq: 'none', weekdays: [], count: null } as RepeatConfig,
          rruleRaw: null,
          untilDate: null,
          title: '',
          memo: '',
          location: '',
          professor: '',
          semesterId: null,
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

  return (
    <EventForm
      key={params.id}
      id={params.id}
      isNew={isNew}
      initial={initial}
      occurrenceStart={typeof params.occ === 'string' && params.occ ? new Date(params.occ) : null}
    />
  );
}

function EventForm({
  id,
  isNew,
  initial,
  occurrenceStart,
}: {
  id: string;
  isNew: boolean;
  initial: FormInitial;
  occurrenceStart: Date | null;
}) {
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
  const [professor, setProfessor] = useState(initial.professor);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startsAt, setStartsAt] = useState<Date>(initial.startsAt);
  const [endsAt, setEndsAt] = useState<Date>(initial.endsAt);
  const [categoryId, setCategoryId] = useState<string | null>(initial.categoryId);
  const [color, setColor] = useState<string | null>(initial.color);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [kind, setKind] = useState<EditorKind>(initial.kind);
  const [repeat, setRepeat] = useState<RepeatConfig>(
    initial.repeat === 'custom' ? { freq: 'none', weekdays: [], count: null } : initial.repeat
  );
  const isCustomRule = initial.repeat === 'custom';
  const [untilDate, setUntilDate] = useState<Date | null>(initial.untilDate);
  const upsertOverride = useUpsertOverride();
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

  // 같은 offset+mode가 둘이면 저장 diff(reminders.ts)가 짝을 못 짓는다 — 애초에 못 만들게 막는다
  const hasReminder = (offsetMinutes: number, mode: 'notify' | 'alarm') =>
    reminders.some((r) => r.offsetMinutes === offsetMinutes && r.mode === mode);

  const toggleReminderMode = (i: number) => {
    const cur = reminders[i];
    const next = cur.mode === 'alarm' ? 'notify' : 'alarm';
    if (hasReminder(cur.offsetMinutes, next)) {
      ToastAndroid.show('같은 알림이 이미 있어요', ToastAndroid.SHORT);
      return;
    }
    setReminders((rs) => rs.map((x, j) => (j === i ? { ...x, mode: next } : x)));
  };

  const cycleReminderSound = (i: number) => {
    haptics.selection();
    setReminders((rs) =>
      rs.map((x, j) => {
        if (j !== i) return x;
        const at = SOUND_OPTIONS.findIndex((o) => o.key === x.soundKey);
        return { ...x, soundKey: SOUND_OPTIONS[(at + 1) % SOUND_OPTIONS.length].key };
      })
    );
  };

  const buildDraft = (): EventDraft => {
    if (kind === 'timetable') {
      // ★ 시간표 과목 편집: kind/semesterId/rrule을 그대로 보존한다 (schedule로 바뀌면 격자에서 사라진다)
      return {
        kind: 'timetable',
        title: title.trim(),
        memo: memo.trim() || null,
        categoryId,
        color,
        allDay: false,
        startsAt,
        endsAt,
        startDate: null,
        endDate: null,
        rrule: initial.rruleRaw,
        rruleUntil: initial.untilDate,
        dueAt: null,
        isDone: false,
        doneAt: null,
        semesterId: initial.semesterId,
        location: location.trim() || null,
        professor: professor.trim() || null,
      };
    }
    if (kind === 'task') {
      return {
        kind: 'task',
        title: title.trim(),
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
      title: title.trim(),
      memo: memo.trim() || null,
      categoryId,
      color,
      allDay,
      // §7.2: 종일이면 date만, 아니면 timestamp만
      startsAt: allDay ? null : startsAt,
      endsAt: allDay ? null : endsAt,
      startDate: allDay ? toDateOnly(startsAt, TZ) : null,
      endDate: allDay ? toDateOnly(endsAt, TZ) : null,
      rrule: isCustomRule ? initial.rruleRaw : toRRuleString(repeat),
      rruleUntil: untilDate,
      dueAt: null,
      isDone: false,
      doneAt: null,
      semesterId: null,
      location: location.trim() || null,
      professor: null,
    };
  };

  /** 저장 전 검증 (stage-13). 위반이면 사유 문자열, 통과면 null */
  const validate = (): string | null => {
    if (!title.trim()) return '제목을 입력하세요';
    if (kind === 'task') return null;
    if (allDay) {
      // 종일은 날짜만 비교 (§7.2) — 같은 날은 허용
      return toDateOnly(endsAt, TZ) < toDateOnly(startsAt, TZ) ? '종료가 시작보다 빠릅니다' : null;
    }
    return endsAt.getTime() <= startsAt.getTime() ? '종료가 시작보다 빠릅니다' : null;
  };

  const afterSave = () => {
    haptics.success();
    router.back();
  };
  const onSaveError = (e: unknown) => {
    // 실패를 절대 조용히 삼키지 않는다 (오프라인 토스트는 assertOnline이 별도 표출)
    console.warn('[chrona] save failed:', e);
    if (String(e) !== 'Error: offline') {
      ToastAndroid.show(`저장 실패: ${String(e)}`, ToastAndroid.LONG);
    }
  };

  const applySave = async (scope: 'one' | 'future' | 'all') => {
    const draft = buildDraft();
    if (scope === 'one' && occurrenceStart) {
      // 이 일정만: override 추가 — 시각 변경만 반영 (stage-5 §1-2 규칙)
      const durationMs = endsAt.getTime() - startsAt.getTime();
      await upsertOverride.mutateAsync({
        eventId: id,
        originalStart: occurrenceStart,
        newStart: startsAt,
        newEnd: new Date(startsAt.getTime() + durationMs),
        isCancelled: false,
      });
      // 알림은 회차가 아니라 이벤트 단위다 — 범위와 무관하게 항상 저장한다
      await saveReminders.mutateAsync({ eventId: id, drafts: reminders });
      return;
    }
    if (scope === 'future' && occurrenceStart) {
      // 이후 모든: 원본 rrule_until을 직전 회차로 자르고 새 event 생성 + reminders 복사
      await updateMutation.mutateAsync({
        id,
        draft: {
          ...draft,
          startsAt: initial.startsAt,
          endsAt: initial.endsAt,
          rruleUntil: new Date(occurrenceStart.getTime() - 60_000),
        },
      });
      const created = await createMutation.mutateAsync(draft);
      await saveReminders.mutateAsync({ eventId: created.id, drafts: reminders });
      return;
    }
    // 모든 일정 (또는 비반복)
    await updateMutation.mutateAsync({ id, draft });
    await saveReminders.mutateAsync({ eventId: id, drafts: reminders });
  };

  const save = async () => {
    const invalid = validate();
    if (invalid) {
      ToastAndroid.show(invalid, ToastAndroid.SHORT);
      return;
    }
    try {
      if (isNew) {
        const created = await createMutation.mutateAsync(buildDraft());
        await saveReminders.mutateAsync({ eventId: created.id, drafts: reminders });
        haptics.success();
        router.back();
        return;
      }
      const isRecurring = !!(isCustomRule ? initial.rruleRaw : toRRuleString(repeat));
      if (isRecurring && occurrenceStart) {
        Alert.alert('반복 일정 수정', '어떤 범위에 적용할까요?', [
          { text: '이 일정만', onPress: () => void applySave('one').then(afterSave, onSaveError) },
          {
            text: '이후 모든 일정',
            onPress: () => void applySave('future').then(afterSave, onSaveError),
          },
          { text: '모든 일정', onPress: () => void applySave('all').then(afterSave, onSaveError) },
        ]);
        return;
      }
      await applySave('all');
      afterSave();
    } catch (e) {
      // 실패를 절대 조용히 삼키지 않는다 (오프라인 토스트는 assertOnline이 별도 표출)
      console.warn('[chrona] save failed:', e);
      if (String(e) !== 'Error: offline') {
        ToastAndroid.show(`저장 실패: ${String(e)}`, ToastAndroid.LONG);
      }
    }
  };

  const remove = () => {
    const isRecurring = !!(isCustomRule ? initial.rruleRaw : toRRuleString(repeat));
    if (isRecurring && occurrenceStart) {
      Alert.alert('반복 일정 삭제', '어떤 범위를 삭제할까요?', [
        {
          text: '이 일정만',
          onPress: () =>
            void upsertOverride
              .mutateAsync({
                eventId: id,
                originalStart: occurrenceStart,
                newStart: null,
                newEnd: null,
                isCancelled: true, // 휴강 (검증 4·5)
              })
              .then(afterSave, onSaveError),
        },
        {
          text: '이후 모든 일정',
          onPress: () =>
            void updateMutation
              .mutateAsync({
                id,
                draft: {
                  ...buildDraft(),
                  startsAt: initial.startsAt,
                  endsAt: initial.endsAt,
                  rruleUntil: new Date(occurrenceStart.getTime() - 60_000),
                },
              })
              .then(afterSave, onSaveError),
        },
        {
          text: '모든 일정 삭제',
          style: 'destructive',
          onPress: () => void deleteMutation.mutateAsync(id).then(afterSave, onSaveError),
        },
      ]);
      return;
    }
    Alert.alert('일정 삭제', '이 일정을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => void deleteMutation.mutateAsync(id).then(afterSave, onSaveError),
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
    if (target === 'startDate' || target === 'startTime') {
      const next = apply(startsAt, target === 'startDate' ? 'date' : 'time');
      // 시작을 뒤로 밀면 종료도 따라간다 — 기존 소요 시간 유지 (되돌려 입력하게 만들지 않는다)
      const durationMs = Math.max(endsAt.getTime() - startsAt.getTime(), 0);
      setStartsAt(next);
      if (endsAt.getTime() <= next.getTime()) setEndsAt(new Date(next.getTime() + durationMs));
      return;
    }
    if (target === 'endDate') setEndsAt((p) => apply(p, 'date'));
    if (target === 'endTime') setEndsAt((p) => apply(p, 'time'));
    if (target === 'untilDate') setUntilDate(apply(startsAt, 'date'));
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
    >
      <AppText variant="title">
        {isNew ? '새로 만들기' : kind === 'task' ? '과제 편집' : kind === 'timetable' ? '수업 편집' : '일정 편집'}
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
      {kind !== 'task' && (
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

      {/* 반복 (stage-5 §1-4) — 일정만 */}
      {kind === 'schedule' && (
        <>
          <AppText variant="caption" color="textSub">
            반복 {isCustomRule ? '(사용자 지정 규칙 — 수정 시 대체됨)' : ''}
          </AppText>
          <View style={styles.chipRow}>
            {(
              [
                ['none', '안 함'],
                ['daily', '매일'],
                ['weekly', '매주'],
                ['biweekly', '격주'],
                ['monthly', '매월'],
              ] as const
            ).map(([f, label]) => (
              <Pressable
                key={f}
                style={[styles.chip, repeat.freq === f && styles.chipActive]}
                onPress={() =>
                  setRepeat((r) => ({
                    freq: f,
                    weekdays:
                      f === 'weekly' || f === 'biweekly'
                        ? r.weekdays.length
                          ? r.weekdays
                          : [(startsAt.getDay() + 0) % 7]
                        : [],
                    count: r.count,
                  }))
                }
              >
                <AppText variant="caption">{label}</AppText>
              </Pressable>
            ))}
          </View>
          {(repeat.freq === 'weekly' || repeat.freq === 'biweekly') && (
            <View style={styles.chipRow}>
              {['일', '월', '화', '수', '목', '금', '토'].map((w, i) => (
                <Pressable
                  key={i}
                  style={[styles.chip, repeat.weekdays.includes(i) && styles.chipActive]}
                  onPress={() =>
                    setRepeat((r) => ({
                      ...r,
                      weekdays: r.weekdays.includes(i)
                        ? r.weekdays.filter((x) => x !== i)
                        : [...r.weekdays, i],
                    }))
                  }
                >
                  <AppText variant="caption">{w}</AppText>
                </Pressable>
              ))}
            </View>
          )}
          {repeat.freq !== 'none' && (
            <View style={styles.rowBetween}>
              <AppText variant="caption" color="textSub">
                {describeRepeat(repeat)}
                {untilDate ? ` · ${toDateOnly(untilDate, TZ)}까지` : ''}
              </AppText>
              <Pressable onPress={() => setPicker('untilDate')}>
                <AppText variant="caption" color="accent">
                  {untilDate ? '종료일 변경' : '종료일 지정'}
                </AppText>
              </Pressable>
            </View>
          )}
        </>
      )}

      {/* 알림 (stage-3 §1-5) */}
      <AppText variant="caption" color="textSub">
        알림
      </AppText>
      {reminders.map((r, i) => (
        <View
          key={i}
          style={[
            styles.reminderRow,
            r.mode === 'alarm' && styles.reminderAlarm,
            !r.enabled && styles.reminderOff,
          ]}
        >
          <AppText nums style={styles.reminderLabel}>
            {r.mode === 'alarm' ? '⏰ ' : ''}
            {offsetLabel(r.offsetMinutes)}
          </AppText>
          <Pressable
            style={[styles.modeChip, r.mode === 'alarm' && styles.modeChipAlarm]}
            onPress={() => toggleReminderMode(i)}
          >
            <AppText variant="caption" color={r.mode === 'alarm' ? 'white' : 'textSub'}>
              {r.mode === 'alarm' ? '알람' : '알림'}
            </AppText>
          </Pressable>
          {/* 알람음: 탭할 때마다 다음 음으로 (피커 모달 없이) */}
          <Pressable style={styles.modeChip} onPress={() => cycleReminderSound(i)}>
            <AppText variant="caption" color="textSub">
              {soundLabel(r.soundKey)}
            </AppText>
          </Pressable>
          <Switch
            value={r.enabled}
            onValueChange={(v) =>
              setReminders((rs) => rs.map((x, j) => (j === i ? { ...x, enabled: v } : x)))
            }
            trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
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
                setShowPresets(false);
                if (hasReminder(p.minutes, 'notify')) {
                  ToastAndroid.show('같은 알림이 이미 있어요', ToastAndroid.SHORT);
                  return;
                }
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

      {kind !== 'task' && (
        <TextInput
          style={styles.input}
          value={location}
          onChangeText={setLocation}
          placeholder={kind === 'timetable' ? '강의실' : '장소'}
          placeholderTextColor={colors.textDim}
        />
      )}
      {kind === 'timetable' && (
        <TextInput
          style={styles.input}
          value={professor}
          onChangeText={setProfessor}
          placeholder="교수"
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
          value={picker === 'untilDate' ? (untilDate ?? endsAt) : picker.startsWith('start') ? startsAt : endsAt}
          mode={picker.endsWith('Date') || picker === 'untilDate' ? 'date' : 'time'}
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
  reminderOff: { opacity: 0.45 },
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

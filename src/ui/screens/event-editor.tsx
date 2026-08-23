/**
 * 일정 상세/편집 (stage-2 §1-7). id === 'new'면 생성 모드.
 * 종일 토글 ON → 시각 필드가 날짜 필드로 전환 (master §7.2를 UI에서 강제).
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCreateEvent, useDeleteEvent, useEvent, useUpdateEvent } from '@/data/hooks/events';
import { useCategories } from '@/data/hooks/settings';
import type { EventDraft } from '@/data/mappers';
import { asDateOnly, formatTimeLabel, fromDateOnly, isDateOnly, toDateOnly } from '@/domain/time';
import { Button } from '@/ui/components/button';
import { ColorDot } from '@/ui/components/color-dot';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { colors, palette, radius, spacing } from '@/ui/tokens';

const TZ = 'Asia/Seoul';

type PickerTarget = 'startDate' | 'startTime' | 'endDate' | 'endTime' | null;

type FormInitial = {
  title: string;
  memo: string;
  location: string;
  allDay: boolean;
  startsAt: Date;
  endsAt: Date;
  categoryId: string | null;
  color: string | null;
};

/** 라우트 래퍼: 데이터 준비 후 폼을 초기값과 함께 마운트 (effect 내 setState 회피) */
export function EventEditor() {
  const params = useLocalSearchParams<{ id: string; date?: string }>();
  const isNew = params.id === 'new';
  const existing = useEvent(isNew ? '' : params.id);

  const baseDate =
    params.date && isDateOnly(params.date) ? params.date : toDateOnly(new Date(), TZ);
  const defaultStart = fromDateOnly(asDateOnly(baseDate), TZ);
  defaultStart.setHours(9, 0, 0, 0);
  const defaultEnd = fromDateOnly(asDateOnly(baseDate), TZ);
  defaultEnd.setHours(10, 0, 0, 0);

  if (!isNew && !existing.data) return <View style={styles.container} />;

  const e = existing.data;
  const initial: FormInitial =
    !isNew && e
      ? {
          title: e.title,
          memo: e.memo ?? '',
          location: e.location ?? '',
          allDay: e.allDay,
          startsAt:
            e.allDay && e.startDate ? fromDateOnly(e.startDate, TZ) : (e.startsAt ?? defaultStart),
          endsAt:
            e.allDay && e.startDate
              ? fromDateOnly(e.endDate ?? e.startDate, TZ)
              : (e.endsAt ?? defaultEnd),
          categoryId: e.categoryId,
          color: e.color,
        }
      : {
          title: '',
          memo: '',
          location: '',
          allDay: false,
          startsAt: defaultStart,
          endsAt: defaultEnd,
          categoryId: null,
          color: null,
        };

  return <EventForm key={params.id} id={params.id} isNew={isNew} initial={initial} />;
}

function EventForm({ id, isNew, initial }: { id: string; isNew: boolean; initial: FormInitial }) {
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

  const buildDraft = (): EventDraft => ({
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
  });

  const save = async () => {
    try {
      if (isNew) {
        await createMutation.mutateAsync(buildDraft());
      } else {
        await updateMutation.mutateAsync({ id, draft: buildDraft() });
      }
      haptics.success();
      router.back();
    } catch {
      // 오프라인 토스트는 assertOnline이 이미 띄움
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
      <AppText variant="title">{isNew ? '새 일정' : '일정 편집'}</AppText>

      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="제목"
        placeholderTextColor={colors.textDim}
      />

      <View style={styles.rowBetween}>
        <AppText>종일</AppText>
        <Switch
          value={allDay}
          onValueChange={setAllDay}
          trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
          thumbColor={colors.text}
        />
      </View>

      {/* 시각 필드 ↔ 날짜 필드 전환 (§7.2 UI 강제) */}
      <View style={styles.rowBetween}>
        <AppText color="textSub">시작</AppText>
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

      <TextInput
        style={styles.input}
        value={location}
        onChangeText={setLocation}
        placeholder="장소"
        placeholderTextColor={colors.textDim}
      />
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

const styles = StyleSheet.create({
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

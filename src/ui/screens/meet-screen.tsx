/**
 * 약속 잡기 (stage-12). 주최 중심 — 그리드 페인팅은 웹, 앱은 생성·공유·현황·확정.
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { fromZonedTime } from 'date-fns-tz';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bestSlots, heatmap, slotLabel } from '@/domain/meet';
import {
  meetLink,
  useConfirmMeetPoll,
  useCreateMeetPoll,
  useDeleteMeetPoll,
  useMeetPolls,
  useMeetResponses,
  type MeetPoll,
} from '@/data/hooks/meet';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

const TZ = 'Asia/Seoul';

export function MeetScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const { data: polls } = useMeetPolls();
  const createPoll = useCreateMeetPoll();
  const [openId, setOpenId] = useState<string | null>(null);

  // 만들기 폼
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [picking, setPicking] = useState<'date' | 'start' | 'end' | null>(null);
  const [timeStart, setTimeStart] = useState('09:00');
  const [timeEnd, setTimeEnd] = useState('22:00');

  const submit = () => {
    if (!title.trim() || dates.length === 0) {
      ToastAndroid.show('제목과 날짜를 입력하세요', ToastAndroid.SHORT);
      return;
    }
    haptics.success();
    createPoll.mutate(
      { title: title.trim(), dates: [...dates].sort(), timeStart, timeEnd },
      {
        onSuccess: (poll) => {
          setCreating(false);
          setTitle('');
          setDates([]);
          setOpenId(poll.id);
          void Share.share({ message: `${poll.title} — 가능한 시간을 알려주세요!\n${meetLink(poll)}` });
        },
        onError: (e) => ToastAndroid.show(String(e), ToastAndroid.LONG),
      }
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
    >
      <View style={styles.headerRow}>
        <AppText variant="display">약속 잡기</AppText>
        <Pressable onPress={() => setCreating((v) => !v)} hitSlop={8}>
          <AppText color="accent" style={styles.bold}>
            {creating ? '닫기' : '+ 만들기'}
          </AppText>
        </Pressable>
      </View>

      {creating && (
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="약속 이름 (예: 팀플 회의)"
            placeholderTextColor={colors.textDim}
          />
          <View style={styles.chipWrap}>
            {dates.map((d) => (
              <Pressable
                key={d}
                style={styles.chip}
                onPress={() => setDates((v) => v.filter((x) => x !== d))}
              >
                <AppText variant="caption" nums>
                  {d.slice(5)} ✕
                </AppText>
              </Pressable>
            ))}
            <Pressable style={[styles.chip, styles.chipAdd]} onPress={() => setPicking('date')}>
              <AppText variant="caption" color="accent">
                + 날짜
              </AppText>
            </Pressable>
          </View>
          <View style={styles.rowBetween}>
            <Pressable onPress={() => setPicking('start')}>
              <AppText color="accent" nums>
                {timeStart}
              </AppText>
            </Pressable>
            <AppText color="textDim">~</AppText>
            <Pressable onPress={() => setPicking('end')}>
              <AppText color="accent" nums>
                {timeEnd}
              </AppText>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={submit}>
              <AppText color="white" style={styles.bold}>
                만들기
              </AppText>
            </Pressable>
          </View>
        </View>
      )}

      {(polls ?? []).length === 0 && !creating && (
        <View style={styles.card}>
          <AppText color="textSub">
            친구들과 시간 맞출 약속을 만들어보세요. 링크만 보내면 로그인 없이 응답할 수 있어요.
          </AppText>
        </View>
      )}

      {(polls ?? []).map((poll) => (
        <PollCard
          key={poll.id}
          poll={poll}
          open={openId === poll.id}
          onToggle={() => setOpenId((v) => (v === poll.id ? null : poll.id))}
          styles={styles}
          colors={colors}
        />
      ))}

      {picking === 'date' && (
        <DateTimePicker
          value={new Date()}
          mode="date"
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            setPicking(null);
            if (e.type === 'set' && d) {
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
                d.getDate()
              ).padStart(2, '0')}`;
              setDates((v) => (v.includes(iso) ? v : [...v, iso]));
            }
          }}
        />
      )}
      {(picking === 'start' || picking === 'end') && (
        <DateTimePicker
          value={(() => {
            const d = new Date();
            const [h, m] = (picking === 'start' ? timeStart : timeEnd).split(':').map(Number);
            d.setHours(h, m, 0, 0);
            return d;
          })()}
          mode="time"
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            const which = picking;
            setPicking(null);
            if (e.type === 'set' && d) {
              const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              if (which === 'start') setTimeStart(t);
              else setTimeEnd(t);
            }
          }}
        />
      )}
    </ScrollView>
  );
}

function PollCard({
  poll,
  open,
  onToggle,
  styles,
  colors,
}: {
  poll: MeetPoll;
  open: boolean;
  onToggle: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: ThemeColors;
}) {
  const { data: responses } = useMeetResponses(open ? poll.id : null);
  const confirm = useConfirmMeetPoll();
  const remove = useDeleteMeetPoll();

  const ranked = useMemo(
    () => (responses ? bestSlots(heatmap(responses), 3) : []),
    [responses]
  );

  return (
    <View style={styles.card}>
      <Pressable style={styles.rowBetween} onPress={onToggle}>
        <View style={styles.flex1}>
          <AppText variant="title">{poll.title}</AppText>
          <AppText variant="caption" color="textSub" nums>
            {poll.dates.length}일 후보 · {poll.timeStart}~{poll.timeEnd}
            {poll.confirmedStart ? ' · ✅ 확정됨' : ''}
          </AppText>
        </View>
        <AppText color="textDim">{open ? '⌃' : '⌄'}</AppText>
      </Pressable>

      {open && (
        <View style={styles.detail}>
          <View style={styles.rowGap}>
            <Pressable
              style={styles.smallBtn}
              onPress={() =>
                void Share.share({
                  message: `${poll.title} — 가능한 시간을 알려주세요!\n${meetLink(poll)}`,
                })
              }
            >
              <AppText variant="caption" color="accent">
                링크 공유
              </AppText>
            </Pressable>
            <Pressable
              style={styles.smallBtn}
              onPress={() => {
                haptics.selection();
                remove.mutate(poll.id);
              }}
            >
              <AppText variant="caption" color="danger">
                삭제
              </AppText>
            </Pressable>
          </View>

          <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
            응답 {responses?.length ?? 0}명 · 많이 겹치는 시간
          </AppText>
          {ranked.length === 0 ? (
            <AppText variant="caption" color="textSub">
              아직 응답이 없어요
            </AppText>
          ) : (
            ranked.map((s) => (
              <View key={s.key} style={styles.rowBetween}>
                <AppText nums>
                  {slotLabel(s.key)}{' '}
                  <AppText variant="caption" color="textSub" nums>
                    {s.count}명 · {s.names.join(', ')}
                  </AppText>
                </AppText>
                {!poll.confirmedStart && (
                  <Pressable
                    style={styles.smallBtn}
                    onPress={() => {
                      haptics.success();
                      confirm.mutate(
                        { poll, startsAt: fromZonedTime(`${s.key}:00`, TZ) },
                        {
                          onSuccess: () =>
                            ToastAndroid.show('확정 — 일정에 추가됨', ToastAndroid.SHORT),
                          onError: (e) => ToastAndroid.show(String(e), ToastAndroid.LONG),
                        }
                      );
                    }}
                  >
                    <AppText variant="caption" color="accent">
                      확정
                    </AppText>
                  </Pressable>
                )}
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.x40, gap: spacing.md },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    bold: { fontWeight: '600' },
    flex1: { flex: 1 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.lg,
      gap: spacing.md,
    },
    input: {
      color: colors.text,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: 15,
    },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    chipAdd: { borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent' },
    rowBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
    },
    rowGap: { flexDirection: 'row', gap: spacing.sm },
    primaryBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    smallBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    detail: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
    sectionLabel: { letterSpacing: 2 },
  });

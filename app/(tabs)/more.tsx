import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Constants from 'expo-constants';

import { signOut } from '@/data/auth';
import {
  chooseBackupDirectory,
  exportBackup,
  exportIcs,
  importBackup,
  importIcs,
  restoreFromAutoBackup,
} from '@/data/backup';
import { useSettings, useUpdateSettings } from '@/data/hooks/settings';
import {
  getLocalSettings,
  localSettingsCache,
  setLocalSettings,
  type LocalSettings,
} from '@/data/local-settings';
import {
  cancelSnoozes,
  dismissAlarm,
  soundLabel,
} from '@/native/alarm';
import { setWeekStartsOn } from '@/domain/calendar';
import { setTimeFormat } from '@/domain/time';
import { rescheduleAll, rescheduleDebounced } from '@/native/rescheduler';
import { SoundPicker } from '@/ui/components/sound-picker';
import { AppText } from '@/ui/components/text';
import { haptics, hapticsEnabled, setHapticsEnabled } from '@/ui/components/haptics';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

type Choice = { label: string; value: string | number };
type Chooser = { title: string; options: Choice[]; onPick: (value: string | number) => void };

/** '9/5 (수)' — 방해금지 종료 시각 표기용 */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatQuietUntil(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 0, 0);
  return x;
}

// Stage 2: 테마/디버그/로그아웃만. 통계·브리핑·권한·백업은 해당 스테이지에서 (master §8)
export default function More() {
  const [pickingBriefing, setPickingBriefing] = useState(false);
  const [pickingMorning, setPickingMorning] = useState(false);
  const [pickingQuietDate, setPickingQuietDate] = useState(false);
  const [chooser, setChooser] = useState<Chooser | null>(null);
  const [pickingSound, setPickingSound] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(hapticsEnabled());
  const [localS, setLocalS] = useState<LocalSettings>(localSettingsCache());
  useEffect(() => {
    void getLocalSettings().then(setLocalS);
  }, []);
  const patchLocal = (patch: Partial<LocalSettings>, reschedule = false) => {
    haptics.selection();
    void setLocalSettings(patch).then((next) => {
      setLocalS(next);
      if (reschedule) rescheduleDebounced();
    });
  };
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

  // ── 알람 전역 제어 (stage-13 §6) ────────────────────────
  const quietActive =
    !!localS.quietUntil && new Date(localS.quietUntil).getTime() > new Date().getTime();

  const toggleQuiet = (on: boolean) => {
    if (!on) {
      patchLocal({ quietUntil: null }, true);
      return;
    }
    haptics.selection();
    setChooser({
      title: '방해금지 (방학 모드)',
      options: [
        { label: '1시간', value: 1 },
        { label: '오늘 하루', value: 0 },
        { label: '3일', value: 72 },
        { label: '7일', value: 168 },
        { label: '날짜 직접 고르기', value: -1 },
      ],
      onPick: (v) => {
        const hours = Number(v);
        if (hours === -1) {
          setPickingQuietDate(true);
          return;
        }
        const until =
          hours === 0 ? endOfDay(new Date()) : new Date(Date.now() + hours * 3600_000);
        patchLocal({ quietUntil: until.toISOString() }, true);
      },
    });
  };

  const chooseTimeout = () =>
    setChooser({
      title: '알람 자동 종료',
      options: [5, 10, 15, 30].map((m) => ({ label: `${m}분`, value: m })),
      onPick: (v) => patchLocal({ alarmTimeoutMinutes: Number(v) }),
    });

  const chooseSnoozeMinutes = () =>
    setChooser({
      title: '스누즈 간격',
      options: [3, 5, 10, 15].map((m) => ({ label: `${m}분`, value: m })),
      onPick: (v) => updateSettings.mutate({ snoozeMinutes: Number(v) }),
    });

  const chooseMaxSnooze = () =>
    setChooser({
      title: '최대 스누즈 횟수',
      options: [1, 2, 3, 5].map((n) => ({ label: `${n}회`, value: n })),
      onPick: (v) => updateSettings.mutate({ maxSnoozeCount: Number(v) }),
    });

  const chooseSound = () => setPickingSound(true);

  const chooseVolume = () =>
    setChooser({
      title: '알람 볼륨',
      options: [50, 70, 85, 100].map((v) => ({ label: `${v}%`, value: v })),
      onPick: (v) => patchLocal({ alarmVolumePercent: Number(v) }),
    });

  // ── 표기·기본값 (stage-15) ─────────────────────────────
  const chooseReminderOffset = () =>
    setChooser({
      title: '기본 알림 오프셋',
      options: [0, 5, 10, 15, 30, 60].map((m) => ({
        label: m === 0 ? '정시' : `${m}분 전`,
        value: m,
      })),
      onPick: (v) => updateSettings.mutate({ defaultReminderOffset: Number(v) }),
    });

  const chooseReminderMode = () =>
    setChooser({
      title: '기본 알림 모드',
      options: [
        { label: '알림', value: 'notify' },
        { label: '알람', value: 'alarm' },
      ],
      onPick: (v) => patchLocal({ defaultReminderMode: v as 'notify' | 'alarm' }),
    });

  const chooseWeekStart = () =>
    setChooser({
      title: '주 시작 요일',
      options: [
        { label: '월요일', value: 1 },
        { label: '일요일', value: 0 },
      ],
      onPick: (v) => {
        const d = Number(v) as 0 | 1;
        setWeekStartsOn(d); // 도메인 격자에 즉시 반영 (다음 렌더부터)
        patchLocal({ weekStartsOn: d });
      },
    });

  const chooseTimeFormat = () =>
    setChooser({
      title: '시각 표기',
      options: [
        { label: '오전/오후', value: '12h' },
        { label: '24시간', value: '24h' },
      ],
      onPick: (v) => {
        const f = v as '12h' | '24h';
        setTimeFormat(f);
        // 알람 payload의 시각 라벨은 재계산 때 굳는다 — 다시 예약해야 바뀐 표기가 반영된다
        patchLocal({ timeFormat: f }, true);
      },
    });

  const choosePreAlarm = () =>
    setChooser({
      title: '알람 예고 (순수 알람 N분 전 약한 진동)',
      options: [
        { label: '끔', value: 0 },
        ...[5, 10, 15].map((m) => ({ label: `${m}분 전`, value: m })),
      ],
      onPick: (v) => patchLocal({ preAlarmMinutes: Number(v) }, true),
    });

  /** 울리는 것 정지 + 예약된 스누즈 제거 + 재계산. 일회성 — 설정을 끄는 게 아니다 */
  const stopEverything = () => {
    haptics.selection();
    Alert.alert('모든 알람 지금 끄기', '울리는 알람을 끄고 예약된 스누즈를 모두 취소합니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '끄기',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await dismissAlarm(''); // id 없이 → 표시 중인 알람 알림 전부 정리
            const n = await cancelSnoozes();
            await rescheduleAll();
            ToastAndroid.show(`알람 해제됨 (스누즈 ${n}건 취소)`, ToastAndroid.SHORT);
          })().catch((e) => ToastAndroid.show(String(e), ToastAndroid.LONG));
        },
      },
    ]);
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
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={chooseWeekStart}>
          <AppText>주 시작 요일</AppText>
          <AppText color="accent">{localS.weekStartsOn === 0 ? '일요일' : '월요일'}</AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={chooseTimeFormat}>
          <AppText>시각 표기</AppText>
          <AppText color="accent">
            {localS.timeFormat === '24h' ? '24시간' : '오전/오후'}
          </AppText>
        </Pressable>
        <View style={styles.divider} />
        <View style={styles.row}>
          <AppText>시험기간 모드</AppText>
          <Switch
            value={localS.examMode}
            onValueChange={(v) => patchLocal({ examMode: v })}
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
        <Pressable style={styles.row} onPress={() => router.push('/meet')}>
          <AppText>약속 잡기 (when2meet)</AppText>
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
            Alert.alert(
              '백업 가져오기',
              '같은 id의 기존 데이터를 백업 내용으로 덮어씁니다. 계속할까요?',
              [
                { text: '취소', style: 'cancel' },
                {
                  text: '가져오기',
                  style: 'destructive',
                  onPress: () =>
                    void importBackup()
                      .then((r) => {
                        if (r) ToastAndroid.show(`${r.restored}건 복원됨`, ToastAndroid.LONG);
                      })
                      .catch((e) => ToastAndroid.show(String(e), ToastAndroid.LONG)),
                },
              ]
            )
          }
        >
          <AppText>백업 가져오기</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          style={styles.row}
          onPress={() =>
            Alert.alert(
              '자동 백업에서 복원',
              '주 1회 자동 저장된 최신 백업으로 덮어씁니다. 계속할까요?',
              [
                { text: '취소', style: 'cancel' },
                {
                  text: '복원',
                  style: 'destructive',
                  onPress: () =>
                    void restoreFromAutoBackup()
                      .then((r) =>
                        ToastAndroid.show(
                          `${r.restored}건 복원됨 (${r.exportedAt.slice(0, 10)} 백업)`,
                          ToastAndroid.LONG
                        )
                      )
                      .catch((e) => ToastAndroid.show(String(e), ToastAndroid.LONG)),
                },
              ]
            )
          }
        >
          <AppText>자동 백업에서 복원</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          style={styles.row}
          onPress={() =>
            void chooseBackupDirectory()
              .then((uri) =>
                ToastAndroid.show(uri ? '자동 백업 폴더 설정됨 (앱 삭제해도 유지)' : '취소됨', ToastAndroid.SHORT)
              )
              .catch((e) => ToastAndroid.show(String(e), ToastAndroid.LONG))
          }
        >
          <AppText>자동 백업 폴더 선택</AppText>
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
        <View style={styles.divider} />
        <Pressable
          style={styles.row}
          onPress={() =>
            Alert.alert('캘린더 가져오기', '.ics 파일의 일정을 새 일정으로 추가합니다. 계속할까요?', [
              { text: '취소', style: 'cancel' },
              {
                text: '가져오기',
                onPress: () =>
                  void importIcs()
                    .then((r) => {
                      if (r) {
                        ToastAndroid.show(`${r.imported}건 가져옴`, ToastAndroid.LONG);
                        rescheduleDebounced();
                      }
                    })
                    .catch((e) => ToastAndroid.show(String(e), ToastAndroid.LONG)),
              },
            ])
          }
        >
          <AppText>캘린더 가져오기 (.ics)</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
      </View>

      <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
        알람
      </AppText>
      {quietActive && (
        <View style={styles.quietBanner}>
          <AppText variant="caption" color="accent">
            방해금지 중 — {formatQuietUntil(localS.quietUntil!)} 까지 알람이 울리지 않아요
          </AppText>
        </View>
      )}
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLabel}>
            <AppText>방해금지 (방학 모드)</AppText>
            {quietActive && (
              <AppText variant="caption" color="textDim">
                ~{formatQuietUntil(localS.quietUntil!)} 까지
              </AppText>
            )}
          </View>
          <Switch
            value={quietActive}
            onValueChange={toggleQuiet}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.white}
          />
        </View>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={stopEverything}>
          <AppText color="danger">모든 알람 지금 끄기</AppText>
          <AppText color="textDim">›</AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={chooseSound}>
          <AppText>기본 알람음</AppText>
          <AppText color="accent">{soundLabel(settings?.defaultSoundKey)}</AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={chooseReminderOffset}>
          <AppText>기본 알림 오프셋</AppText>
          <AppText color="accent" nums>
            {(settings?.defaultReminderOffset ?? 10) === 0
              ? '정시'
              : `${settings?.defaultReminderOffset ?? 10}분 전`}
          </AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={chooseReminderMode}>
          <AppText>기본 알림 모드</AppText>
          <AppText color="accent">
            {localS.defaultReminderMode === 'alarm' ? '알람' : '알림'}
          </AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={chooseVolume}>
          <AppText>알람 볼륨</AppText>
          <AppText color="accent" nums>{localS.alarmVolumePercent}%</AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={choosePreAlarm}>
          <AppText>알람 예고</AppText>
          <AppText color="accent" nums>
            {localS.preAlarmMinutes > 0 ? `${localS.preAlarmMinutes}분 전` : '끔'}
          </AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={chooseSnoozeMinutes}>
          <AppText>스누즈 간격</AppText>
          <AppText color="accent" nums>
            {settings?.snoozeMinutes ?? 5}분
          </AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={chooseMaxSnooze}>
          <AppText>최대 스누즈 횟수</AppText>
          <AppText color="accent" nums>
            {settings?.maxSnoozeCount ?? 3}회
          </AppText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={chooseTimeout}>
          <AppText>알람 자동 종료</AppText>
          <AppText color="accent" nums>
            {localS.alarmTimeoutMinutes}분
          </AppText>
        </Pressable>
        <View style={styles.divider} />
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
          <AppText>아침 브리핑</AppText>
          <Switch
            value={localS.morningBriefingEnabled}
            onValueChange={(v) => patchLocal({ morningBriefingEnabled: v }, true)}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.white}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <AppText>아침 브리핑 시각</AppText>
          <Pressable onPress={() => setPickingMorning(true)}>
            <AppText color="accent" nums>
              {localS.morningBriefingTime}
            </AppText>
          </Pressable>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={styles.rowLabel}>
            <AppText>브리핑 주말 제외</AppText>
            <AppText variant="caption" color="textDim">
              주말엔 브리핑을 보내지 않아요
            </AppText>
          </View>
          <Switch
            value={localS.briefingSkipWeekend}
            onValueChange={(v) => patchLocal({ briefingSkipWeekend: v }, true)}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.white}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <AppText>점진적 볼륨 (30초)</AppText>
          <Switch
            value={localS.gradualVolume}
            onValueChange={(v) => patchLocal({ gradualVolume: v })}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.white}
          />
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

      {pickingMorning && (
        <DateTimePicker
          value={(() => {
            const d = new Date();
            const [h, m] = localS.morningBriefingTime.split(':').map(Number);
            d.setHours(h, m, 0, 0);
            return d;
          })()}
          mode="time"
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            setPickingMorning(false);
            if (e.type === 'set' && d) {
              patchLocal(
                {
                  morningBriefingTime: `${String(d.getHours()).padStart(2, '0')}:${String(
                    d.getMinutes()
                  ).padStart(2, '0')}`,
                },
                true
              );
            }
          }}
        />
      )}

      {pickingQuietDate && (
        <DateTimePicker
          value={new Date(new Date().getTime() + 86400_000)}
          mode="date"
          minimumDate={new Date()}
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            setPickingQuietDate(false);
            if (e.type === 'set' && d) {
              patchLocal({ quietUntil: endOfDay(d).toISOString() }, true);
            }
          }}
        />
      )}

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

      <SoundPicker
        visible={pickingSound}
        title="기본 알람음"
        value={settings?.defaultSoundKey}
        onPick={(key) => updateSettings.mutate({ defaultSoundKey: key })}
        onClose={() => setPickingSound(false)}
      />
      {/* 선택지 3개를 넘는 설정이 많아 Alert 대신 공용 시트를 쓴다 (안드로이드 Alert는 버튼 3개 한계) */}
      <Modal visible={!!chooser} transparent animationType="fade" onRequestClose={() => setChooser(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setChooser(null)}>
          <View style={styles.modalCard}>
            <AppText variant="title">{chooser?.title}</AppText>
            {chooser?.options.map((o) => (
              <Pressable
                key={String(o.value)}
                style={styles.choice}
                onPress={() => {
                  const pick = chooser.onPick;
                  setChooser(null);
                  haptics.selection();
                  pick(o.value);
                }}
              >
                <AppText>{o.label}</AppText>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
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
    rowLabel: { gap: 2 },
    quietBanner: {
      backgroundColor: colors.surface,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: `${colors.black}88`,
      justifyContent: 'center',
      padding: spacing.xl,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      gap: spacing.xs,
    },
    choice: { paddingVertical: spacing.md, minHeight: 44, justifyContent: 'center' },
  });

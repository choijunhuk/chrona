/** 검색 (stage-8 §3). Postgres ilike — 제목·메모·장소, kind별 섹션 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/data/supabase';
import type { EventRow } from '@/data/mappers';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

const RECENT_KEY = 'chrona.recent-searches';
const KIND_LABEL = { schedule: '일정', task: '과제', timetable: '시간표' } as const;

export default function Search() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [q, setQ] = useState('');
  const [results, setResults] = useState<EventRow[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(RECENT_KEY).then((r) => {
      if (r) setRecent(JSON.parse(r));
    });
  }, []);

  const run = async (term: string) => {
    const t = term.trim();
    if (!t) return;
    const like = `%${t}%`;
    const { data } = await supabase
      .from('events')
      .select('*')
      .or(`title.ilike.${like},memo.ilike.${like},location.ilike.${like}`)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(50);
    setResults((data as EventRow[]) ?? []);
    setSearched(true);
    const next = [t, ...recent.filter((r) => r !== t)].slice(0, 5);
    setRecent(next);
    void AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  const sections = useMemo(() => {
    const by: Record<string, EventRow[]> = {};
    for (const r of results) (by[r.kind] ??= []).push(r);
    return (['schedule', 'task', 'timetable'] as const)
      .filter((k) => by[k]?.length)
      .map((k) => ({ kind: k, rows: by[k] }));
  }, [results]);

  /** 검색어 하이라이트 */
  const highlight = (text: string) => {
    const t = q.trim();
    if (!t) return <AppText>{text}</AppText>;
    const idx = text.toLowerCase().indexOf(t.toLowerCase());
    if (idx < 0) return <AppText>{text}</AppText>;
    return (
      <AppText>
        {text.slice(0, idx)}
        <AppText color="accent" style={styles.hl}>
          {text.slice(idx, idx + t.length)}
        </AppText>
        {text.slice(idx + t.length)}
      </AppText>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder="제목, 메모, 장소 검색"
          placeholderTextColor={colors.textDim}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => void run(q)}
        />
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <AppText color="accent">닫기</AppText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {!searched && recent.length > 0 && (
          <>
            <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
              최근 검색
            </AppText>
            <View style={styles.recentWrap}>
              {recent.map((r) => (
                <Pressable
                  key={r}
                  style={styles.recentChip}
                  onPress={() => {
                    setQ(r);
                    void run(r);
                  }}
                >
                  <AppText variant="caption">{r}</AppText>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {searched && results.length === 0 && (
          <AppText color="textDim" style={styles.empty}>
            결과가 없어요
          </AppText>
        )}

        {sections.map((sec) => (
          <View key={sec.kind} style={styles.section}>
            <AppText variant="micro" color="textDim" style={styles.sectionLabel}>
              {KIND_LABEL[sec.kind]}
            </AppText>
            {sec.rows.map((r) => (
              <Pressable
                key={r.id}
                style={styles.item}
                onPress={() =>
                  router.push({
                    pathname: '/event/[id]',
                    // 반복 일정은 기준 회차를 함께 넘겨 "이 일정만/이후/전체" 선택이 뜨게 한다
                    params:
                      r.rrule && r.starts_at
                        ? { id: r.id, occ: new Date(r.starts_at).toISOString() }
                        : { id: r.id },
                  })
                }
              >
                {highlight(r.title)}
                <AppText variant="caption" color="textSub" numberOfLines={1}>
                  {r.all_day
                    ? r.start_date
                    : r.starts_at
                      ? new Date(r.starts_at).toLocaleDateString()
                      : r.due_at
                        ? `마감 ${new Date(r.due_at).toLocaleDateString()}`
                        : ''}
                  {r.location ? ` · ${r.location}` : ''}
                </AppText>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    input: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      color: colors.text,
      fontSize: 15,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    body: { paddingVertical: spacing.lg, gap: spacing.md, paddingBottom: spacing.x40 },
    sectionLabel: { letterSpacing: 2, marginBottom: spacing.xs },
    recentWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    recentChip: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    empty: { textAlign: 'center', paddingTop: spacing.x40 },
    section: { gap: spacing.xs },
    item: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.lg,
      gap: 2,
    },
    hl: { fontWeight: '700' },
  });

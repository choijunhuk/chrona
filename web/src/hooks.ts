/** 웹 데이터 훅 — 앱과 같은 매퍼(@app-data/mappers, 순수)와 domain을 재사용 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';

import type { Database } from '@app-data/database.types';
import type { EventDraft, EventOverrideRow, EventRow, CategoryRow } from '@app-data/mappers';
import {
  toDomainCategory,
  toDomainEvent,
  toDomainOverride,
  toEventInsert,
} from '@app-data/mappers';
import type { Category, ChronaEvent, EventOverride, MeetPollInfo } from '@chrona/domain';

import { supabase } from './supabase';

const TZ = 'Asia/Seoul';

export type MeetPollRow = Database['public']['Tables']['meet_polls']['Row'];

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => (await supabase.auth.getSession()).data.session,
  });
}

export function useEvents(range: { from: Date; to: Date }) {
  return useQuery({
    queryKey: ['events', range.from.toISOString(), range.to.toISOString()],
    queryFn: async (): Promise<ChronaEvent[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .is('deleted_at', null)
        .or(
          [
            `rrule.not.is.null`,
            `and(all_day.eq.false,starts_at.lte.${range.to.toISOString()},ends_at.gte.${range.from.toISOString()})`,
            `all_day.eq.true`,
            `kind.eq.task`,
          ].join(',')
        );
      if (error) throw error;
      return (data as EventRow[]).map(toDomainEvent);
    },
  });
}

export function useOverrides() {
  return useQuery({
    queryKey: ['overrides'],
    queryFn: async (): Promise<EventOverride[]> => {
      const { data, error } = await supabase.from('event_overrides').select('*');
      if (error) throw error;
      return (data as EventOverrideRow[]).map(toDomainOverride);
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from('categories').select('*').order('sort_order');
      if (error) throw error;
      return (data as CategoryRow[]).map(toDomainCategory);
    },
  });
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('not authenticated');
  return data.session.user.id;
}

export function useSaveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }: { id: string | null; draft: EventDraft }) => {
      const insert = toEventInsert(draft, await uid());
      if (id) {
        const { error } = await supabase.from('events').update(insert).eq('id', id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await supabase.from('events').insert(insert).select('id').single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['events'] }),
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('events')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['events'] }),
  });
}

export function useUpsertOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (d: {
      eventId: string;
      originalStart: Date;
      newStart: Date | null;
      newEnd: Date | null;
      isCancelled: boolean;
    }) => {
      const { error } = await supabase.from('event_overrides').upsert(
        {
          event_id: d.eventId,
          original_start: d.originalStart.toISOString(),
          new_start: d.newStart?.toISOString() ?? null,
          new_end: d.newEnd?.toISOString() ?? null,
          is_cancelled: d.isCancelled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,original_start' }
      );
      if (error) throw error;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['overrides'] });
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

export function emptyDraft(): EventDraft {
  return {
    kind: 'schedule',
    title: '',
    memo: null,
    categoryId: null,
    color: null,
    allDay: false,
    startsAt: null,
    endsAt: null,
    startDate: null,
    endDate: null,
    rrule: null,
    rruleUntil: null,
    dueAt: null,
    isDone: false,
    doneAt: null,
    semesterId: null,
    location: null,
    professor: null,
  };
}

// ── 약속 잡기 (stage-12) ────────────────────────────────
// 참여자는 로그인이 없다 — RPC 두 개만 쓴다. 주최자는 RLS로 자기 폴에 직접 접근.

/** 익명 조회 — 없는/삭제된 폴이면 null */
export function useMeetPoll(token: string) {
  return useQuery({
    queryKey: ['meet-poll', token],
    queryFn: async (): Promise<MeetPollInfo | null> => {
      const { data, error } = await supabase.rpc('meet_get_poll', { p_token: token });
      if (error) throw error;
      return (data as MeetPollInfo | null) ?? null;
    },
  });
}

export function useSubmitMeetResponse(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, slots }: { name: string; slots: string[] }) => {
      const { error } = await supabase.rpc('meet_submit_response', {
        p_token: token,
        p_name: name,
        p_slots: slots,
      });
      if (error) throw error;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['meet-poll', token] }),
  });
}

/** 내가 만든 폴 목록 (RLS가 주최자만 통과시킨다) */
export function useMyPolls(enabled: boolean) {
  return useQuery({
    queryKey: ['meet-polls'],
    enabled,
    queryFn: async (): Promise<MeetPollRow[]> => {
      const { data, error } = await supabase
        .from('meet_polls')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/** 참여자 화면에서 "내가 주최자인가" — 로그인 상태일 때만 조회, 아니면 null */
export function useOwnedPoll(token: string, enabled: boolean) {
  return useQuery({
    queryKey: ['meet-owned', token],
    enabled,
    queryFn: async (): Promise<MeetPollRow | null> => {
      const { data, error } = await supabase
        .from('meet_polls')
        .select('*')
        .eq('share_token', token)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (d: {
      title: string;
      dates: string[];
      timeStart: string;
      timeEnd: string;
    }) => {
      const { error } = await supabase.from('meet_polls').insert({
        user_id: await uid(),
        title: d.title,
        dates: d.dates,
        time_start: d.timeStart,
        time_end: d.timeEnd,
      });
      if (error) throw error;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['meet-polls'] }),
  });
}

export function useDeletePoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('meet_polls')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['meet-polls'] }),
  });
}

/**
 * 슬롯 확정: 폴에 confirmed_start를 박고 같은 시각으로 내 일정을 만든다.
 * 슬롯 키는 폴의 벽시계 좌표라 KST로 해석해서 timestamptz로 올린다.
 */
export function useConfirmMeetSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (d: {
      pollId: string;
      title: string;
      slotKey: string;
      slotMinutes: number;
    }) => {
      const startsAt = fromZonedTime(`${d.slotKey}:00`, TZ);
      const endsAt = new Date(startsAt.getTime() + d.slotMinutes * 60_000);
      const userId = await uid();
      const { error } = await supabase
        .from('meet_polls')
        .update({
          confirmed_start: startsAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', d.pollId);
      if (error) throw error;
      const { error: insertError } = await supabase
        .from('events')
        .insert(toEventInsert({ ...emptyDraft(), title: d.title, startsAt, endsAt }, userId));
      if (insertError) throw insertError;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['meet-poll'] });
      void qc.invalidateQueries({ queryKey: ['meet-polls'] });
      void qc.invalidateQueries({ queryKey: ['meet-owned'] });
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

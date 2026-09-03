/**
 * events CRUD 훅 (stage-1 §1-8).
 * - 전 mutation 낙관적 업데이트 (실패 시 롤백)
 * - delete는 soft delete (deleted_at)
 * - updated_at은 mappers에서 항상 명시 세팅 (master §7.3)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ChronaEvent } from '@/domain/types';
import { toDateOnly } from '@/domain/time';

import { qk } from '../keys';
import type { EventDraft, EventRow } from '../mappers';
import { toDomainEvent, toEventInsert } from '../mappers';
import { assertOnline } from '../net';
import { supabase } from '../supabase';
import { rescheduleDebounced } from '@/native/rescheduler';

export type EventRange = { from: Date; to: Date; tz: string };

function rangeKey(range: EventRange) {
  return qk.events({ from: range.from.toISOString(), to: range.to.toISOString() });
}

/** 기간 조회. 반복 전개는 Stage 5 — 여기선 rrule 없는 단건 + all_day만 겹침 판정 */
export function useEvents(range: EventRange) {
  return useQuery({
    queryKey: rangeKey(range),
    queryFn: async (): Promise<ChronaEvent[]> => {
      const fromDate = toDateOnly(range.from, range.tz);
      const toDate = toDateOnly(range.to, range.tz);
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .is('deleted_at', null)
        .or(
          [
            // 반복 일정: 규칙만 저장돼 있으므로 range 필터 불가 — 항상 가져와 클라이언트에서 전개
            `rrule.not.is.null`,
            // 시각 일정: 기간과 겹침
            `and(all_day.eq.false,starts_at.lte.${range.to.toISOString()},ends_at.gte.${range.from.toISOString()})`,
            // 종일 일정: date 문자열 비교 (시간대 무관 — master §7.2)
            `and(all_day.eq.true,start_date.lte.${toDate},end_date.gte.${fromDate})`,
            // task: due_at 기준
            `and(kind.eq.task,due_at.gte.${range.from.toISOString()},due_at.lte.${range.to.toISOString()})`,
          ].join(',')
        )
        .order('starts_at', { ascending: true });
      if (error) throw error;
      return (data as EventRow[]).map(toDomainEvent);
    },
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: qk.event(id),
    // 생성 모드('new')·빈 id에서는 조회하지 않는다 (존재하지 않는 행 404 방지)
    enabled: !!id && id !== 'new',
    queryFn: async (): Promise<ChronaEvent> => {
      const { data, error } = await supabase.from('events').select('*').eq('id', id).single();
      if (error) throw error;
      return toDomainEvent(data as EventRow);
    },
  });
}

async function currentUserId(): Promise<string> {
  // getSession = 로컬 조회 (getUser는 네트워크 왕복이라 감산)
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('not authenticated');
  return data.session.user.id;
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: EventDraft): Promise<ChronaEvent> => {
      assertOnline();
      const userId = await currentUserId();
      const { data, error } = await supabase
        .from('events')
        .insert(toEventInsert(draft, userId))
        .select()
        .single();
      if (error) throw error;
      return toDomainEvent(data as EventRow);
    },
    // 낙관적 업데이트: 목록 캐시에 임시 행 삽입
    onMutate: async (draft) => {
      await qc.cancelQueries({ queryKey: qk.allEvents() });
      const snapshot = qc.getQueriesData<ChronaEvent[]>({ queryKey: qk.allEvents() });
      const optimistic: ChronaEvent = {
        ...draft,
        id: `optimistic-${Math.random().toString(36).slice(2)}`,
        updatedAt: new Date(),
      };
      qc.setQueriesData<ChronaEvent[]>({ queryKey: qk.allEvents() }, (old) =>
        Array.isArray(old) ? [...old, optimistic] : old
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.allEvents() });
      rescheduleDebounced(); // master §3.6 트리거 2 (CRUD)
    },
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: EventDraft }) => {
      assertOnline();
      const userId = await currentUserId();
      const { data, error } = await supabase
        .from('events')
        .update(toEventInsert(draft, userId))
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return toDomainEvent(data as EventRow);
    },
    onMutate: async ({ id, draft }) => {
      await qc.cancelQueries({ queryKey: qk.allEvents() });
      const snapshot = qc.getQueriesData<ChronaEvent[]>({ queryKey: qk.allEvents() });
      qc.setQueriesData<ChronaEvent[]>({ queryKey: qk.allEvents() }, (old) =>
        Array.isArray(old)
          ? old.map((e) => (e.id === id ? { ...e, ...draft, updatedAt: new Date() } : e))
          : old
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.allEvents() });
      rescheduleDebounced();
    },
  });
}

/** 삭제 되돌리기 (stage-15 스낵바). soft delete라 deleted_at만 되돌린다 */
export function useRestoreEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      assertOnline();
      const { error } = await supabase
        .from('events')
        .update({ deleted_at: null, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.allEvents() });
      rescheduleDebounced();
    },
  });
}

/** ★ soft delete (stage-1 §1-8). 물리 삭제 금지 (master §7.3) */
export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      assertOnline();
      const { error } = await supabase
        .from('events')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.allEvents() });
      const snapshot = qc.getQueriesData<ChronaEvent[]>({ queryKey: qk.allEvents() });
      qc.setQueriesData<ChronaEvent[]>({ queryKey: qk.allEvents() }, (old) =>
        Array.isArray(old) ? old.filter((e) => e.id !== id) : old
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.allEvents() });
      rescheduleDebounced();
    },
  });
}

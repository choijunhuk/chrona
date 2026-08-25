/** 웹 데이터 훅 — 앱과 같은 매퍼(@app-data/mappers, 순수)와 domain을 재사용 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { EventDraft, EventOverrideRow, EventRow, CategoryRow } from '@app-data/mappers';
import {
  toDomainCategory,
  toDomainEvent,
  toDomainOverride,
  toEventInsert,
} from '@app-data/mappers';
import type { Category, ChronaEvent, EventOverride } from '@chrona/domain';

import { supabase } from './supabase';

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

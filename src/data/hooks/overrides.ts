/** event_overrides 조회 + 생성 (stage-5). 소량 테이블 — 전체 조회 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { EventOverride } from '@/domain/types';
import { rescheduleDebounced } from '@/native/rescheduler';

import type { EventOverrideRow } from '../mappers';
import { toDomainOverride } from '../mappers';
import { assertOnline } from '../net';
import { supabase } from '../supabase';

const OK = ['eventOverrides'] as const;

export function useOverrides() {
  return useQuery({
    queryKey: OK,
    queryFn: async (): Promise<EventOverride[]> => {
      const { data, error } = await supabase.from('event_overrides').select('*');
      if (error) throw error;
      return (data as EventOverrideRow[]).map(toDomainOverride);
    },
  });
}

export type OverrideDraft = {
  eventId: string;
  originalStart: Date;
  newStart: Date | null;
  newEnd: Date | null;
  isCancelled: boolean;
};

/** 회차 override upsert (같은 회차 재수정 시 교체) */
export function useUpsertOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: OverrideDraft) => {
      assertOnline();
      const { error } = await supabase.from('event_overrides').upsert(
        {
          event_id: draft.eventId,
          original_start: draft.originalStart.toISOString(),
          new_start: draft.newStart?.toISOString() ?? null,
          new_end: draft.newEnd?.toISOString() ?? null,
          is_cancelled: draft.isCancelled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,original_start' }
      );
      if (error) throw error;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: OK });
      void qc.invalidateQueries({ queryKey: ['events'] });
      rescheduleDebounced(); // 휴강 회차 알람 제거 (검증 5)
    },
  });
}

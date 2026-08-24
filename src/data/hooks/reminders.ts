/** reminders 조회/저장 (stage-3 §1-5). 저장은 이벤트 단위 replace — 트랜잭션처럼 다룬다 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Reminder } from '@/domain/types';
import { rescheduleDebounced } from '@/native/rescheduler';

import type { ReminderDraft, ReminderRow } from '../mappers';
import { toDomainReminder, toReminderInsert } from '../mappers';
import { assertOnline } from '../net';
import { supabase } from '../supabase';

const rk = (eventId: string) => ['reminders', eventId] as const;

export function useReminders(eventId: string | null) {
  return useQuery({
    queryKey: rk(eventId ?? 'none'),
    enabled: !!eventId,
    queryFn: async (): Promise<Reminder[]> => {
      const { data, error } = await supabase
        .from('reminders')
        .select('*')
        .eq('event_id', eventId!)
        .order('offset_minutes');
      if (error) throw error;
      return (data as ReminderRow[]).map(toDomainReminder);
    },
  });
}

/** 이벤트의 알림 세트를 통째로 교체. 실패 시 기존 유지(삭제 전 insert 검증 불가라 순서 주의) */
export function useSaveReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, drafts }: { eventId: string; drafts: ReminderDraft[] }) => {
      assertOnline();
      // 새 세트 먼저 insert → 성공하면 이전 것 삭제 (역순이면 실패 시 알림이 통째로 사라진다)
      const { data: existing, error: selError } = await supabase
        .from('reminders')
        .select('id')
        .eq('event_id', eventId);
      if (selError) throw selError;
      if (drafts.length > 0) {
        const { error: insError } = await supabase
          .from('reminders')
          .insert(drafts.map((d) => toReminderInsert(d, eventId)));
        if (insError) throw insError;
      }
      if (existing.length > 0) {
        const { error: delError } = await supabase
          .from('reminders')
          .delete()
          .in(
            'id',
            existing.map((r) => r.id)
          );
        if (delError) throw delError;
      }
    },
    onSettled: (_d, _e, { eventId }) => {
      void qc.invalidateQueries({ queryKey: rk(eventId) });
      rescheduleDebounced(); // master §3.6 트리거 2
    },
  });
}

/** 과제 전용 훅 (stage-4). 완료 토글 시 관련 알림도 정리 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ChronaEvent } from '@/domain/types';
import { rescheduleDebounced } from '@/native/rescheduler';

import { qk } from '../keys';
import type { EventRow } from '../mappers';
import { toDomainEvent } from '../mappers';
import { assertOnline } from '../net';
import { supabase } from '../supabase';

export function useTasks() {
  return useQuery({
    queryKey: [...qk.allEvents(), 'tasks'],
    queryFn: async (): Promise<ChronaEvent[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('kind', 'task')
        .is('deleted_at', null)
        .order('due_at', { ascending: true });
      if (error) throw error;
      return (data as EventRow[]).map(toDomainEvent);
    },
  });
}

/** 완료 토글. 완료 시 reminders는 그대로 두되 재계산이 isDone을 걸러 알람이 사라진다 */
export function useToggleTaskDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      assertOnline();
      const { error } = await supabase
        .from('events')
        .update({
          is_done: done,
          done_at: done ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: qk.allEvents() });
      const snapshot = qc.getQueriesData<ChronaEvent[]>({ queryKey: qk.allEvents() });
      qc.setQueriesData<ChronaEvent[]>({ queryKey: qk.allEvents() }, (old) =>
        Array.isArray(old)
          ? old.map((e) => (e.id === id ? { ...e, isDone: done, doneAt: done ? new Date() : null } : e))
          : old
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.allEvents() });
      rescheduleDebounced(); // 완료된 과제의 알람 제거 (schedule.ts가 isDone 필터)
    },
  });
}

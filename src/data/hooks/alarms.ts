/** 순수 알람(standalone_alarms) CRUD (stage-3 §1-6). 모든 변경은 재계산 트리거 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { StandaloneAlarm } from '@/domain/types';
import { rescheduleDebounced } from '@/native/rescheduler';

import type { StandaloneAlarmDraft, StandaloneAlarmRow } from '../mappers';
import { toDomainStandaloneAlarm, toStandaloneAlarmInsert } from '../mappers';
import { assertOnline } from '../net';
import { supabase } from '../supabase';

const AK = ['standaloneAlarms'] as const;

export function useStandaloneAlarms() {
  return useQuery({
    queryKey: AK,
    queryFn: async (): Promise<StandaloneAlarm[]> => {
      const { data, error } = await supabase
        .from('standalone_alarms')
        .select('*')
        .is('deleted_at', null)
        .order('time');
      if (error) throw error;
      return (data as StandaloneAlarmRow[]).map(toDomainStandaloneAlarm);
    },
  });
}

function useAlarmMutation<TVars>(fn: (vars: TVars) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: TVars) => {
      assertOnline();
      await fn(vars);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: AK });
      rescheduleDebounced();
    },
  });
}

export function useCreateAlarm() {
  return useAlarmMutation(async (draft: StandaloneAlarmDraft) => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) throw new Error('not authenticated');
    const { error } = await supabase
      .from('standalone_alarms')
      .insert(toStandaloneAlarmInsert(draft, s.session.user.id));
    if (error) throw error;
  });
}

export function useToggleAlarm() {
  return useAlarmMutation(async ({ id, enabled }: { id: string; enabled: boolean }) => {
    const { error } = await supabase
      .from('standalone_alarms')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  });
}

export function useDeleteAlarm() {
  return useAlarmMutation(async (id: string) => {
    // soft delete (master §7.3)
    const { error } = await supabase
      .from('standalone_alarms')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  });
}

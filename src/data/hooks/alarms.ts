/** 순수 알람(standalone_alarms) CRUD (stage-3 §1-6). 모든 변경은 재계산 트리거 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { StandaloneAlarm } from '@/domain/types';
import { rescheduleDebounced } from '@/native/rescheduler';

import type { StandaloneAlarmDraft, StandaloneAlarmRow } from '../mappers';
import {
  toDomainStandaloneAlarm,
  toStandaloneAlarmInsert,
  toStandaloneAlarmUpdate,
} from '../mappers';
import { assertOnline, toastMutationError } from '../net';
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
    onError: (e) => toastMutationError(e, '알람 저장 실패'),
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

/** 편집 저장 (stage-15). enabled는 useToggleAlarm 담당 — 여기선 폼이 다루는 필드만 */
export function useUpdateAlarm() {
  return useAlarmMutation(
    async ({ id, patch }: { id: string; patch: Partial<StandaloneAlarmDraft> }) => {
      const { error } = await supabase
        .from('standalone_alarms')
        .update(toStandaloneAlarmUpdate(patch))
        .eq('id', id);
      if (error) throw error;
    }
  );
}

/** 켜기/끄기는 낙관적 업데이트 — 왕복 동안 스위치가 되돌아가 보이면 안 된다 (settings.ts 패턴) */
export function useToggleAlarm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      assertOnline();
      const { error } = await supabase
        .from('standalone_alarms')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: AK });
      const prev = qc.getQueryData<StandaloneAlarm[]>(AK);
      if (prev) {
        qc.setQueryData<StandaloneAlarm[]>(
          AK,
          prev.map((a) => (a.id === id ? { ...a, enabled } : a))
        );
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(AK, ctx.prev);
      toastMutationError(e, '알람 변경 실패');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: AK });
      rescheduleDebounced();
    },
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

/** 삭제 되돌리기 (stage-15). soft delete라 deleted_at만 되돌리면 된다 */
export function useRestoreAlarm() {
  return useAlarmMutation(async (id: string) => {
    const { error } = await supabase
      .from('standalone_alarms')
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  });
}

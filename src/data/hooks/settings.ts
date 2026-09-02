import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AppSettings, Category } from '@/domain/types';
import { rescheduleDebounced } from '@/native/rescheduler';

import { qk } from '../keys';
import type { AppSettingsRow, CategoryRow } from '../mappers';
import { toDomainCategory, toDomainSettings, toSettingsUpdate } from '../mappers';
import { assertOnline } from '../net';
import { supabase } from '../supabase';

export function useCategories() {
  return useQuery({
    queryKey: qk.categories(),
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data as CategoryRow[]).map(toDomainCategory);
    },
  });
}

export function useSettings() {
  return useQuery({
    queryKey: qk.settings(),
    queryFn: async (): Promise<AppSettings> => {
      const { data, error } = await supabase.from('app_settings').select('*').single();
      if (error) throw error;
      return toDomainSettings(data as AppSettingsRow);
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => {
      assertOnline();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error('not authenticated');
      const { error } = await supabase
        .from('app_settings')
        .update(toSettingsUpdate(patch))
        .eq('user_id', userData.user.id);
      if (error) throw error;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.settings() });
      const prev = qc.getQueryData<AppSettings>(qk.settings());
      if (prev) qc.setQueryData(qk.settings(), { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.settings(), ctx.prev);
    },
    onSettled: () => {
      // 스누즈 간격·기본 알람음 등은 예약된 payload에 박혀 있다 — 설정이 바뀌면 다시 예약해야 반영된다
      rescheduleDebounced();
      return qc.invalidateQueries({ queryKey: qk.settings() });
    },
  });
}

/** focus_sessions 조회 (stage-7). 기본 최근 90일 */
import { useQuery } from '@tanstack/react-query';

import type { FocusSession } from '@/domain/types';

import { supabase } from '../supabase';

type Row = {
  id: string;
  event_id: string | null;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number;
  completed: boolean;
};

export function useFocusSessions() {
  return useQuery({
    queryKey: ['focusSessions'],
    queryFn: async (): Promise<FocusSession[]> => {
      const since = new Date(Date.now() - 90 * 86400_000).toISOString();
      const { data, error } = await supabase
        .from('focus_sessions')
        .select('id,event_id,started_at,ended_at,planned_minutes,completed')
        .gte('started_at', since)
        .order('started_at');
      if (error) throw error;
      return (data as Row[]).map((r) => ({
        id: r.id,
        eventId: r.event_id,
        startedAt: new Date(r.started_at),
        endedAt: r.ended_at ? new Date(r.ended_at) : null,
        plannedMinutes: r.planned_minutes,
        completed: r.completed,
      }));
    },
  });
}

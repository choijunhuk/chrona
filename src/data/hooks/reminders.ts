/** reminders 조회/저장 (stage-3 §1-5). 저장은 이벤트 단위 diff — 비트랜잭션 교체를 피한다 */
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

/** 여러 이벤트의 알림을 한 번에 (시간표 일괄 토글용 — 이벤트별 조회 N+1 회피) */
export function useRemindersForEvents(eventIds: string[]) {
  const ids = [...eventIds].sort();
  return useQuery({
    queryKey: ['reminders', 'byEvents', ids.join(',')] as const,
    enabled: ids.length > 0,
    queryFn: async (): Promise<Reminder[]> => {
      const { data, error } = await supabase.from('reminders').select('*').in('event_id', ids);
      if (error) throw error;
      return (data as ReminderRow[]).map(toDomainReminder);
    },
  });
}

/** 알림 1건의 동일성 키 — 같은 offset+mode는 같은 행으로 본다 (편집기가 중복 추가를 막는다) */
const draftKey = (r: { offsetMinutes: number; mode: string }) => `${r.offsetMinutes}|${r.mode}`;

/**
 * 이벤트의 알림 세트 저장 (stage-13). insert→delete 순차 교체는 비트랜잭션이라
 * 중간 실패 시 중복/유실이 생긴다. 대신 diff:
 *   기존과 짝지어진 행은 update, 새 것만 insert, 사라진 것만 delete.
 */
export function useSaveReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, drafts }: { eventId: string; drafts: ReminderDraft[] }) => {
      assertOnline();
      const { data, error: selError } = await supabase
        .from('reminders')
        .select('*')
        .eq('event_id', eventId);
      if (selError) throw selError;
      const existing = (data as ReminderRow[]) ?? [];

      const byKey = new Map(existing.map((r) => [draftKey({ offsetMinutes: r.offset_minutes, mode: r.mode }), r]));
      const keptIds = new Set<string>();
      const toInsert: ReminderDraft[] = [];

      for (const d of drafts) {
        const row = byKey.get(draftKey(d));
        if (!row) {
          toInsert.push(d);
          continue;
        }
        keptIds.add(row.id);
        // 남은 필드(소리·진동·사용여부)만 제자리 갱신
        if (row.sound_key !== d.soundKey || row.vibrate !== d.vibrate || row.enabled !== d.enabled) {
          const { error } = await supabase
            .from('reminders')
            .update(toReminderInsert(d, eventId))
            .eq('id', row.id);
          if (error) throw error;
        }
      }

      if (toInsert.length > 0) {
        const { error } = await supabase
          .from('reminders')
          .insert(toInsert.map((d) => toReminderInsert(d, eventId)));
        if (error) throw error;
      }

      const removed = existing.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
      if (removed.length > 0) {
        const { error } = await supabase.from('reminders').delete().in('id', removed);
        if (error) throw error;
      }
    },
    onSettled: () => {
      // byEvents 캐시까지 무효화 (prefix 매칭)
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      rescheduleDebounced(); // master §3.6 트리거 2
    },
  });
}

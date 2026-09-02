/** 학기·교시·시간표 훅 (stage-5 §1-6·1-7·1-9) */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PeriodPreset, Semester } from '@/domain/types';
import { fromDateOnly, type DateOnly } from '@/domain/time';
import { rescheduleDebounced } from '@/native/rescheduler';

import { qk } from '../keys';
import type { EventRow, PeriodPresetRow } from '../mappers';
import { toDomainEvent, toDomainPeriodPreset } from '../mappers';
import { assertOnline, toastMutationError } from '../net';
import { supabase } from '../supabase';

const SK = ['semesters'] as const;

type SemesterRowT = {
  id: string;
  user_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  updated_at: string;
};

export function useSemesters() {
  return useQuery({
    queryKey: SK,
    queryFn: async (): Promise<Semester[]> => {
      const { data, error } = await supabase
        .from('semesters')
        .select('*')
        .order('start_date', { ascending: false });
      if (error) throw error;
      return (data as SemesterRowT[]).map((r) => ({
        id: r.id,
        name: r.name,
        startDate: r.start_date as DateOnly,
        endDate: r.end_date as DateOnly,
        isActive: r.is_active,
      }));
    },
  });
}

export function useCreateSemester() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: { name: string; startDate: DateOnly; endDate: DateOnly }) => {
      assertOnline();
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw new Error('not authenticated');
      // 새 학기를 활성으로: 기존 활성 해제
      await supabase
        .from('semesters')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('is_active', true);
      const { data, error } = await supabase
        .from('semesters')
        .insert({
          user_id: s.session.user.id,
          name: draft.name,
          start_date: draft.startDate,
          end_date: draft.endDate,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data as SemesterRowT;
    },
    onError: (e) => toastMutationError(e, '학기 저장 실패'),
    onSettled: () => void qc.invalidateQueries({ queryKey: SK }),
  });
}

export function useSetActiveSemester() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      assertOnline();
      await supabase
        .from('semesters')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('is_active', true);
      const { error } = await supabase
        .from('semesters')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onError: (e) => toastMutationError(e, '학기 전환 실패'),
    onSettled: () => void qc.invalidateQueries({ queryKey: SK }),
  });
}

export function usePeriodPresets() {
  return useQuery({
    queryKey: qk.periodPresets(),
    queryFn: async (): Promise<PeriodPreset[]> => {
      const { data, error } = await supabase
        .from('period_presets')
        .select('*')
        .order('period_no');
      if (error) throw error;
      return (data as PeriodPresetRow[]).map(toDomainPeriodPreset);
    },
  });
}

export function useUpdatePeriodPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, startTime, endTime }: { id: string; startTime: string; endTime: string }) => {
      assertOnline();
      const { error } = await supabase
        .from('period_presets')
        .update({ start_time: startTime, end_time: endTime, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onError: (e) => toastMutationError(e, '교시 저장 실패'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.periodPresets() });
      rescheduleDebounced();
    },
  });
}

/** 활성 학기의 시간표 과목들 */
export function useTimetableEvents(semesterId: string | null) {
  return useQuery({
    queryKey: [...qk.allEvents(), 'timetable', semesterId ?? 'none'],
    enabled: !!semesterId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('kind', 'timetable')
        .eq('semester_id', semesterId!)
        .is('deleted_at', null);
      if (error) throw error;
      return (data as EventRow[]).map(toDomainEvent);
    },
  });
}

const BYDAY_OF = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** 시간표 블록 생성: 요일+교시 범위 → 매주 반복 event (stage-5 §1-7) */
export function useCreateTimetableBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      semester,
      weekday, // 0=일 ~ 6=토
      startTime, // 'HH:MM'
      endTime,
      title,
      color,
      location,
      tz,
    }: {
      semester: Semester;
      weekday: number;
      startTime: string;
      endTime: string;
      title: string;
      color: string;
      location: string | null;
      tz: string;
    }) => {
      assertOnline();
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw new Error('not authenticated');
      // 학기 시작일 이후 첫 해당 요일 찾기
      const start = fromDateOnly(semester.startDate, tz);
      const first = new Date(start);
      while (first.getDay() !== weekday) first.setDate(first.getDate() + 1);
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const startsAt = new Date(first);
      startsAt.setHours(sh, sm, 0, 0);
      const endsAt = new Date(first);
      endsAt.setHours(eh, em, 0, 0);
      const untilEnd = fromDateOnly(semester.endDate, tz);
      untilEnd.setHours(23, 59, 0, 0);

      const { error } = await supabase.from('events').insert({
        user_id: s.session.user.id,
        kind: 'timetable',
        title,
        color,
        all_day: false,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        rrule: `FREQ=WEEKLY;BYDAY=${BYDAY_OF[weekday]}`,
        rrule_until: untilEnd.toISOString(),
        semester_id: semester.id,
        location,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onError: (e) => toastMutationError(e, '시간표 저장 실패'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.allEvents() });
      rescheduleDebounced();
    },
  });
}

/** 학기 복사: 시간표 과목 통째 복제, 날짜만 새 학기 기준 (stage-5 §1-6) */
export function useCopySemesterTimetable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ from, to, tz }: { from: Semester; to: Semester; tz: string }) => {
      assertOnline();
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw new Error('not authenticated');
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('kind', 'timetable')
        .eq('semester_id', from.id)
        .is('deleted_at', null);
      if (error) throw error;

      const newStart = fromDateOnly(to.startDate, tz);
      const untilEnd = fromDateOnly(to.endDate, tz);
      untilEnd.setHours(23, 59, 0, 0);

      const rows = (data as EventRow[]).map((r) => {
        const oldStart = new Date(r.starts_at!);
        const oldEnd = new Date(r.ends_at!);
        // 새 학기 시작일 이후 같은 요일 첫 날로 이동, 시각 유지
        const first = new Date(newStart);
        while (first.getDay() !== oldStart.getDay()) first.setDate(first.getDate() + 1);
        const startsAt = new Date(first);
        startsAt.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
        const endsAt = new Date(first);
        endsAt.setHours(oldEnd.getHours(), oldEnd.getMinutes(), 0, 0);
        return {
          user_id: s.session!.user.id,
          kind: 'timetable',
          title: r.title,
          color: r.color,
          all_day: false,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          rrule: r.rrule,
          rrule_until: untilEnd.toISOString(),
          semester_id: to.id,
          location: r.location,
          professor: r.professor,
          updated_at: new Date().toISOString(),
        };
      });
      if (rows.length > 0) {
        const { error: insError } = await supabase.from('events').insert(rows);
        if (insError) throw insError;
      }
      return rows.length;
    },
    onError: (e) => toastMutationError(e, '시간표 저장 실패'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.allEvents() });
      rescheduleDebounced();
    },
  });
}

/**
 * 약속 잡기(meet) 훅 (stage-12). 주최자 전용 — 익명 참여자는 웹 RPC로만 접근.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { MeetResponse } from '@/domain/meet';

import { qk } from '../keys';
import { assertOnline, toastMutationError } from '../net';
import { supabase } from '../supabase';
import { rescheduleDebounced } from '@/native/rescheduler';

export type MeetPoll = {
  id: string;
  title: string;
  dates: string[];
  timeStart: string; // 'HH:MM'
  timeEnd: string;
  slotMinutes: number;
  shareToken: string;
  confirmedStart: Date | null;
  createdAt: Date;
};

type PollRow = {
  id: string;
  title: string;
  dates: string[];
  time_start: string;
  time_end: string;
  slot_minutes: number;
  share_token: string;
  confirmed_start: string | null;
  created_at: string;
};

const toPoll = (r: PollRow): MeetPoll => ({
  id: r.id,
  title: r.title,
  dates: r.dates,
  timeStart: r.time_start.slice(0, 5),
  timeEnd: r.time_end.slice(0, 5),
  slotMinutes: r.slot_minutes,
  shareToken: r.share_token,
  confirmedStart: r.confirmed_start ? new Date(r.confirmed_start) : null,
  createdAt: new Date(r.created_at),
});

/** 공유 링크 — 웹 배포 도메인 고정 */
export const MEET_WEB_BASE = 'https://chrona-ebon.vercel.app';
export const meetLink = (p: MeetPoll) => `${MEET_WEB_BASE}/#/meet/${p.shareToken}`;

export function useMeetPolls() {
  return useQuery({
    queryKey: qk.meetPolls(),
    queryFn: async (): Promise<MeetPoll[]> => {
      const { data, error } = await supabase
        .from('meet_polls')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as PollRow[]).map(toPoll);
    },
  });
}

export function useMeetResponses(pollId: string | null) {
  return useQuery({
    queryKey: qk.meetResponses(pollId ?? 'none'),
    enabled: !!pollId,
    queryFn: async (): Promise<MeetResponse[]> => {
      const { data, error } = await supabase
        .from('meet_responses')
        .select('participant_name, slots')
        .eq('poll_id', pollId!);
      if (error) throw error;
      return (data as { participant_name: string; slots: string[] }[]).map((r) => ({
        name: r.participant_name,
        slots: r.slots,
      }));
    },
  });
}

export function useCreateMeetPoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      dates: string[];
      timeStart: string;
      timeEnd: string;
    }): Promise<MeetPoll> => {
      assertOnline();
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw new Error('로그인 필요');
      const { data, error } = await supabase
        .from('meet_polls')
        .insert({
          user_id: s.session.user.id,
          title: input.title,
          dates: input.dates,
          time_start: input.timeStart,
          time_end: input.timeEnd,
        })
        .select()
        .single();
      if (error) throw error;
      return toPoll(data as PollRow);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.meetPolls() }),
  });
}

export function useDeleteMeetPoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      assertOnline();
      const { error } = await supabase
        .from('meet_polls')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onError: (e) => toastMutationError(e, '삭제 실패'),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.meetPolls() }),
  });
}

/**
 * 확정: confirmed_start 기록 + Chrona 일정 생성 + 알람 재계산.
 * startsAt은 슬롯 키를 Asia/Seoul 벽시계로 해석한 UTC Date (호출측에서 변환).
 */
export function useConfirmMeetPoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      poll,
      startsAt,
    }: {
      poll: MeetPoll;
      startsAt: Date;
    }) => {
      assertOnline();
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw new Error('로그인 필요');
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('meet_polls')
        .update({ confirmed_start: startsAt.toISOString(), updated_at: nowIso })
        .eq('id', poll.id);
      if (error) throw error;
      const { error: evErr } = await supabase.from('events').insert({
        user_id: s.session.user.id,
        kind: 'schedule',
        title: poll.title,
        all_day: false,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + poll.slotMinutes * 60_000).toISOString(),
        is_done: false,
        updated_at: nowIso,
      });
      if (evErr) throw evErr;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.meetPolls() });
      void qc.invalidateQueries({ queryKey: qk.allEvents() });
      rescheduleDebounced();
    },
  });
}

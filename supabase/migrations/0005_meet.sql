-- Chrona 0005_meet — 약속 잡기 (stage-12)
-- 익명 참여자는 테이블 직접 접근 불가. security definer RPC 2개로만 읽고 쓴다.

-- ── meet_polls ──────────────────────────────────────────
create table public.meet_polls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  dates date[] not null,
  time_start time not null,
  time_end time not null,
  slot_minutes int not null default 30,
  share_token uuid not null unique default gen_random_uuid(),
  confirmed_start timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint meet_polls_dates_check check (array_length(dates, 1) between 1 and 31),
  constraint meet_polls_time_check check (time_end > time_start),
  constraint meet_polls_slot_check check (slot_minutes in (15, 30, 60))
);

create index meet_polls_user_id_idx on public.meet_polls (user_id);

-- ── meet_responses ──────────────────────────────────────
create table public.meet_responses (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.meet_polls (id) on delete cascade,
  participant_name text not null,
  slots text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (poll_id, participant_name),
  constraint meet_responses_name_check check (char_length(participant_name) between 1 and 20),
  constraint meet_responses_slots_check check (array_length(slots, 1) is null or array_length(slots, 1) <= 500)
);

create index meet_responses_poll_id_idx on public.meet_responses (poll_id);

-- ── RLS: 주최자만 직접 접근 ─────────────────────────────
alter table public.meet_polls enable row level security;
alter table public.meet_responses enable row level security;

create policy meet_polls_owner on public.meet_polls
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy meet_responses_owner on public.meet_responses
  for all using (
    exists (
      select 1 from public.meet_polls p
      where p.id = poll_id and p.user_id = (select auth.uid())
    )
  );

-- ── RPC: 익명 접근 통로 ─────────────────────────────────

-- 폴 조회: 주최자 정보 미노출. 삭제된 폴은 없음 취급
create or replace function public.meet_get_poll(p_token uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'title', p.title,
    'dates', p.dates,
    'timeStart', p.time_start,
    'timeEnd', p.time_end,
    'slotMinutes', p.slot_minutes,
    'confirmedStart', p.confirmed_start,
    'responses', coalesce(
      (select jsonb_agg(jsonb_build_object('name', r.participant_name, 'slots', r.slots) order by r.updated_at)
       from public.meet_responses r where r.poll_id = p.id),
      '[]'::jsonb
    )
  )
  from public.meet_polls p
  where p.share_token = p_token and p.deleted_at is null;
$$;

-- 응답 제출: 같은 이름이면 교체. 확정된 폴은 마감
create or replace function public.meet_submit_response(p_token uuid, p_name text, p_slots text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poll_id uuid;
  v_count int;
begin
  select id into v_poll_id from public.meet_polls
    where share_token = p_token and deleted_at is null and confirmed_start is null;
  if v_poll_id is null then
    raise exception 'poll not found or closed';
  end if;
  if char_length(trim(p_name)) not between 1 and 20 then
    raise exception 'invalid name';
  end if;
  if array_length(p_slots, 1) > 500 then
    raise exception 'too many slots';
  end if;
  select count(*) into v_count from public.meet_responses where poll_id = v_poll_id;
  if v_count >= 50 and not exists (
    select 1 from public.meet_responses where poll_id = v_poll_id and participant_name = trim(p_name)
  ) then
    raise exception 'poll is full';
  end if;

  insert into public.meet_responses (poll_id, participant_name, slots, updated_at)
  values (v_poll_id, trim(p_name), p_slots, now())
  on conflict (poll_id, participant_name)
  do update set slots = excluded.slots, updated_at = now();
end;
$$;

-- anon/authenticated 모두 이 두 함수만 실행 가능
revoke execute on function public.meet_get_poll(uuid) from public;
revoke execute on function public.meet_submit_response(uuid, text, text[]) from public;
grant execute on function public.meet_get_poll(uuid) to anon, authenticated;
grant execute on function public.meet_submit_response(uuid, text, text[]) to anon, authenticated;

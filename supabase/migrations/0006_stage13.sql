-- Chrona 0006_stage13 — 복원 트랜잭션 RPC + 약속 잡기 하드닝 (stage-13)
-- 1) restore_backup: 백업 JSON 한 덩어리를 한 트랜잭션으로 복원 (security invoker → RLS 그대로)
-- 2) meet_*: client_key 기반 이름 선점, 길이 상한, updated_at 트리거

-- ════════════════════════════════════════════════════════
-- 1. restore_backup — 백업 복원 단일 트랜잭션
-- ════════════════════════════════════════════════════════
-- security invoker: RLS를 우회하지 않는다. 행마다 user_id를 auth.uid()로 강제해
-- 페이로드의 user_id(다른 계정 백업일 수 있다)를 무시한다 — RLS with check와 이중 방어.
-- 실패하면 함수 전체가 롤백 → 반쯤 복원된 상태가 남지 않는다 (기존 테이블별 upsert의 결함).
create or replace function public.restore_backup(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_own jsonb;   -- user_id 강제 주입용 조각
  v_data jsonb := payload -> 'data';
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_data is null or jsonb_typeof(v_data) <> 'object' then
    raise exception 'invalid payload';
  end if;
  v_own := jsonb_build_object('user_id', v_uid);

  -- FK 의존 순서: categories/semesters → period_presets → events → 자식들

  insert into public.categories
  select c.*
  from jsonb_array_elements(coalesce(v_data -> 'categories', '[]'::jsonb)) as e(r)
  cross join lateral jsonb_populate_record(null::public.categories, e.r || v_own) as c
  on conflict (id) do update set
    name = excluded.name,
    color = excluded.color,
    icon = excluded.icon,
    sort_order = excluded.sort_order;

  insert into public.semesters
  select c.*
  from jsonb_array_elements(coalesce(v_data -> 'semesters', '[]'::jsonb)) as e(r)
  cross join lateral jsonb_populate_record(null::public.semesters, e.r || v_own) as c
  on conflict (id) do update set
    name = excluded.name,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    is_active = excluded.is_active;

  -- period_presets는 (user_id, period_no)가 유니크 — 첫 실행 시딩과 부딪히므로 그쪽을 충돌 키로
  insert into public.period_presets
  select c.*
  from jsonb_array_elements(coalesce(v_data -> 'period_presets', '[]'::jsonb)) as e(r)
  cross join lateral jsonb_populate_record(null::public.period_presets, e.r || v_own) as c
  on conflict (user_id, period_no) do update set
    start_time = excluded.start_time,
    end_time = excluded.end_time;

  insert into public.events
  select c.*
  from jsonb_array_elements(coalesce(v_data -> 'events', '[]'::jsonb)) as e(r)
  cross join lateral jsonb_populate_record(null::public.events, e.r || v_own) as c
  on conflict (id) do update set
    kind = excluded.kind,
    title = excluded.title,
    memo = excluded.memo,
    category_id = excluded.category_id,
    color = excluded.color,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    all_day = excluded.all_day,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    rrule = excluded.rrule,
    rrule_until = excluded.rrule_until,
    due_at = excluded.due_at,
    is_done = excluded.is_done,
    done_at = excluded.done_at,
    semester_id = excluded.semester_id,
    location = excluded.location,
    professor = excluded.professor,
    deleted_at = excluded.deleted_at;

  -- 자식 테이블은 user_id가 없다 (부모 events 경유 RLS) — v_own을 섞지 않는다
  insert into public.event_overrides
  select c.*
  from jsonb_array_elements(coalesce(v_data -> 'event_overrides', '[]'::jsonb)) as e(r)
  cross join lateral jsonb_populate_record(null::public.event_overrides, e.r) as c
  on conflict (id) do update set
    new_start = excluded.new_start,
    new_end = excluded.new_end,
    is_cancelled = excluded.is_cancelled;

  insert into public.reminders
  select c.*
  from jsonb_array_elements(coalesce(v_data -> 'reminders', '[]'::jsonb)) as e(r)
  cross join lateral jsonb_populate_record(null::public.reminders, e.r) as c
  on conflict (id) do update set
    offset_minutes = excluded.offset_minutes,
    mode = excluded.mode,
    sound_key = excluded.sound_key,
    vibrate = excluded.vibrate,
    enabled = excluded.enabled;

  insert into public.standalone_alarms
  select c.*
  from jsonb_array_elements(coalesce(v_data -> 'standalone_alarms', '[]'::jsonb)) as e(r)
  cross join lateral jsonb_populate_record(null::public.standalone_alarms, e.r || v_own) as c
  on conflict (id) do update set
    "time" = excluded."time",   -- time은 col_name_keyword — 따옴표로 확실히
    weekdays = excluded.weekdays,
    label = excluded.label,
    enabled = excluded.enabled,
    sound_key = excluded.sound_key,
    vibrate = excluded.vibrate,
    deleted_at = excluded.deleted_at;

  -- exportBackup이 내보내는 테이블이라 함께 복원한다 (빠뜨리면 통계 기록이 조용히 사라진다)
  insert into public.focus_sessions
  select c.*
  from jsonb_array_elements(coalesce(v_data -> 'focus_sessions', '[]'::jsonb)) as e(r)
  cross join lateral jsonb_populate_record(null::public.focus_sessions, e.r || v_own) as c
  on conflict (id) do update set
    event_id = excluded.event_id,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    planned_minutes = excluded.planned_minutes,
    completed = excluded.completed;

  insert into public.app_settings
  select c.*
  from jsonb_array_elements(coalesce(v_data -> 'app_settings', '[]'::jsonb)) as e(r)
  cross join lateral jsonb_populate_record(null::public.app_settings, e.r || v_own) as c
  on conflict (user_id) do update set
    ongoing_enabled = excluded.ongoing_enabled,
    briefing_enabled = excluded.briefing_enabled,
    briefing_time = excluded.briefing_time,
    default_reminder_offset = excluded.default_reminder_offset,
    snooze_minutes = excluded.snooze_minutes,
    max_snooze_count = excluded.max_snooze_count,
    default_sound_key = excluded.default_sound_key,
    fixed_timezone = excluded.fixed_timezone,
    theme = excluded.theme,
    permission_checked_at = excluded.permission_checked_at;
end;
$$;

revoke execute on function public.restore_backup(jsonb) from public;
revoke execute on function public.restore_backup(jsonb) from anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════
-- 2. 약속 잡기 하드닝
-- ════════════════════════════════════════════════════════

-- 2-1. 이름 선점: 브라우저별 client_key로 "먼저 쓴 사람"만 자기 응답을 고칠 수 있게 한다
alter table public.meet_responses add column client_key text;

alter table public.meet_responses drop constraint meet_responses_name_check;
alter table public.meet_responses add constraint meet_responses_name_check
  check (char_length(participant_name) between 1 and 40);
alter table public.meet_responses add constraint meet_responses_client_key_check
  check (client_key is null or char_length(client_key) between 1 and 64);

-- 2-2. 길이 상한 (제목 80자). 슬롯 키 32자 상한은 RPC에서 — check 제약은 서브쿼리를 못 쓴다
alter table public.meet_polls add constraint meet_polls_title_check
  check (char_length(title) between 1 and 80);

-- 2-3. updated_at 자동 갱신 (0001_init.sql의 전 테이블 규칙에 meet_* 합류)
create trigger set_updated_at before update on public.meet_polls
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.meet_responses
  for each row execute function extensions.moddatetime(updated_at);

-- 2-4. 응답 제출 — 인자 추가라 기존 시그니처를 지우고 다시 만든다 (오버로드 모호성 방지)
drop function public.meet_submit_response(uuid, text, text[]);

create or replace function public.meet_submit_response(
  p_token uuid,
  p_name text,
  p_slots text[],
  p_client_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poll_id uuid;
  v_name text := trim(p_name);
  v_count int;
  v_existing_key text;
  v_found boolean;
begin
  select id into v_poll_id from public.meet_polls
    where share_token = p_token and deleted_at is null and confirmed_start is null;
  if v_poll_id is null then
    raise exception 'poll not found or closed';
  end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception 'invalid name';
  end if;
  if p_client_key is not null and char_length(p_client_key) not between 1 and 64 then
    raise exception 'invalid client key';
  end if;
  if array_length(p_slots, 1) > 500 then
    raise exception 'too many slots';
  end if;
  if exists (select 1 from unnest(p_slots) as s where char_length(s) > 32) then
    raise exception 'invalid slot';
  end if;

  select client_key, true into v_existing_key, v_found
    from public.meet_responses
    where poll_id = v_poll_id and participant_name = v_name;

  -- 남이 먼저 쓴 이름은 덮어쓸 수 없다. 키가 없는 옛 응답은 누구든 이어받을 수 있게 둔다
  if coalesce(v_found, false)
     and v_existing_key is not null
     and v_existing_key is distinct from p_client_key then
    raise exception 'name_taken' using errcode = 'unique_violation';
  end if;

  if not coalesce(v_found, false) then
    select count(*) into v_count from public.meet_responses where poll_id = v_poll_id;
    if v_count >= 50 then
      raise exception 'poll is full';
    end if;
  end if;

  -- 별칭을 둬야 do update에서 기존 행의 값을 안전하게 참조할 수 있다
  insert into public.meet_responses as r (poll_id, participant_name, slots, client_key, updated_at)
  values (v_poll_id, v_name, p_slots, p_client_key, now())
  on conflict (poll_id, participant_name)
  do update set
    slots = excluded.slots,
    client_key = coalesce(r.client_key, excluded.client_key),
    updated_at = now();
end;
$$;

revoke execute on function public.meet_submit_response(uuid, text, text[], text) from public;
grant execute on function public.meet_submit_response(uuid, text, text[], text) to anon, authenticated;

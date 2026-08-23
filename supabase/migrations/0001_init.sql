-- Chrona 0001_init — 전체 스키마 (master §7.1)
-- Stage 1에서 전 테이블·전 컬럼을 한 번에 생성한다. 이후 스테이지에서 스키마 변경 없음.

create extension if not exists moddatetime with schema extensions;

-- ── categories ──────────────────────────────────────────
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null,
  icon text,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

-- ── semesters ───────────────────────────────────────────
create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,                      -- '2026-2학기'
  start_date date not null,
  end_date date not null,
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ── period_presets ──────────────────────────────────────
create table public.period_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_no int not null,
  start_time time not null,
  end_time time not null,
  updated_at timestamptz not null default now(),
  unique (user_id, period_no)
);

-- ── events (일정/시간표/과제 통합) ───────────────────────
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('schedule', 'timetable', 'task')),
  title text not null,
  memo text,
  category_id uuid references public.categories (id) on delete set null,
  color text,                              -- 미지정 시 category 색 상속

  -- 시각 (master §7.2): all_day=true → start_date/end_date(date),
  -- all_day=false → starts_at/ends_at(timestamptz, UTC)
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean not null default false,
  start_date date,
  end_date date,

  -- 반복 (규칙만 저장, 전개는 클라이언트 — Stage 5)
  rrule text,
  rrule_until timestamptz,

  -- task 전용
  due_at timestamptz,
  is_done boolean not null default false,
  done_at timestamptz,

  -- timetable 전용
  semester_id uuid references public.semesters (id) on delete set null,
  location text,
  professor text,

  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- §7.2 강제: 종일 일정은 date만, 시각 일정은 timestamptz만
  constraint events_time_shape check (
    (all_day = true  and start_date is not null and starts_at is null and ends_at is null)
    or
    (all_day = false and start_date is null and end_date is null)
  )
);

-- ── event_overrides (반복 회차 예외) ─────────────────────
create table public.event_overrides (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  original_start timestamptz not null,     -- 어느 회차인지 식별
  new_start timestamptz,
  new_end timestamptz,
  is_cancelled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (event_id, original_start)
);

-- ── reminders ───────────────────────────────────────────
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  offset_minutes int not null default 10,  -- 시작 전 분. task는 due_at 기준
  mode text not null default 'notify' check (mode in ('notify', 'alarm')),
  sound_key text not null default 'default',
  vibrate boolean not null default true,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ── standalone_alarms (시계 앱) ──────────────────────────
create table public.standalone_alarms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  time time not null,
  weekdays int[] not null default '{}',    -- 0=일 ~ 6=토. 빈 배열이면 1회성
  label text,
  enabled boolean not null default true,
  sound_key text not null default 'default',
  vibrate boolean not null default true,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── focus_sessions (통계 소스) ───────────────────────────
create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  planned_minutes int not null,
  completed boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ── app_settings (단일 행) ───────────────────────────────
create table public.app_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  briefing_enabled boolean not null default true,
  briefing_time time not null default '23:00',
  default_reminder_offset int not null default 10,
  snooze_minutes int not null default 5,
  max_snooze_count int not null default 3,
  default_sound_key text not null default 'default',
  fixed_timezone text,                     -- 'Asia/Seoul' 고정 옵션 (null = 기기 시간대)
  theme text not null default 'dark',
  permission_checked_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ── 필수 인덱스 (stage-1 §1-3) ───────────────────────────
create index events_user_starts_idx on public.events (user_id, starts_at) where deleted_at is null;
create index events_user_task_due_idx on public.events (user_id, kind, due_at) where kind = 'task';
create index events_user_semester_idx on public.events (user_id, semester_id) where kind = 'timetable';
create index events_user_updated_idx on public.events (user_id, updated_at);
create index event_overrides_event_start_idx on public.event_overrides (event_id, original_start);
create index reminders_event_enabled_idx on public.reminders (event_id) where enabled = true;
create index focus_sessions_user_started_idx on public.focus_sessions (user_id, started_at);

-- ── updated_at 자동 갱신 트리거 (전 테이블, master §7.3) ──
create trigger set_updated_at before update on public.categories
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.semesters
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.period_presets
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.events
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.event_overrides
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.reminders
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.standalone_alarms
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.focus_sessions
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.app_settings
  for each row execute function extensions.moddatetime(updated_at);

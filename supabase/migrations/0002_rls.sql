-- Chrona 0002_rls — 전 테이블 RLS (master §7.4)
-- 전부 auth.uid() = user_id. event_overrides / reminders는 부모 events를 통해 확인.
-- RLS를 켠 상태로 개발한다 (stage-1 §1-4).

alter table public.categories enable row level security;
alter table public.semesters enable row level security;
alter table public.period_presets enable row level security;
alter table public.events enable row level security;
alter table public.event_overrides enable row level security;
alter table public.reminders enable row level security;
alter table public.standalone_alarms enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.app_settings enable row level security;

-- user_id 직접 보유 테이블
create policy "own rows" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows" on public.semesters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows" on public.period_presets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows" on public.events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows" on public.standalone_alarms
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows" on public.focus_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows" on public.app_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 부모 events 경유 테이블
create policy "own via event" on public.event_overrides
  for all using (
    exists (select 1 from public.events e
            where e.id = event_overrides.event_id and e.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.events e
            where e.id = event_overrides.event_id and e.user_id = auth.uid())
  );

create policy "own via event" on public.reminders
  for all using (
    exists (select 1 from public.events e
            where e.id = reminders.event_id and e.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.events e
            where e.id = reminders.event_id and e.user_id = auth.uid())
  );

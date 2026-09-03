-- Chrona 0007_stage15 — 순수 알람 해제 게이트(challenge) 컬럼 (stage-15)
-- 'none'이면 밀어서 해제, 'math'는 수학 문제, 'shake'는 흔들기 15회.
-- 기본값 'none' → 기존 알람은 동작이 바뀌지 않는다.
alter table public.standalone_alarms
  add column challenge text not null default 'none'
  check (challenge in ('none','math','shake'));

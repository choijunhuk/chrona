-- Stage 3: 상시 알림(오늘 일정 요약) 설정 (stage-3 §1-7). 기본 끔 (사용자 확정)
alter table public.app_settings
  add column ongoing_enabled boolean not null default false;

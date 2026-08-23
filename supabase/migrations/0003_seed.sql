-- Chrona 0003_seed — 첫 실행 시딩 (master §7.5)
--
-- 정적 SQL 시딩이 불가능한 이유: user_id가 가입 전엔 존재하지 않는다.
-- 대신 auth.users INSERT 트리거로 자동 시딩한다.
-- 재설치·계정 재생성에도 클라이언트 코드 없이 동작한다.
--
-- 교시 프리셋: 사용자 결정으로 기본값 시딩 (1교시 09:00 시작, 75분 수업 / 15분 간격).
-- 실제 광운대 시간과 다르면 시간표 스테이지(Stage 5)에서 수정한다.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- 기본 카테고리 4개
  insert into public.categories (user_id, name, color, icon, sort_order) values
    (new.id, '학교', '#6C7BFF', 'school',   0),
    (new.id, '과제', '#D87B9E', 'task',     1),
    (new.id, '개인', '#7BC98A', 'person',   2),
    (new.id, '약속', '#D89B6C', 'calendar', 3);

  -- 교시 프리셋 (기본값 — Stage 5에서 실측값으로 수정 가능)
  insert into public.period_presets (user_id, period_no, start_time, end_time) values
    (new.id, 1, '09:00', '10:15'),
    (new.id, 2, '10:30', '11:45'),
    (new.id, 3, '12:00', '13:15'),
    (new.id, 4, '13:30', '14:45'),
    (new.id, 5, '15:00', '16:15'),
    (new.id, 6, '16:30', '17:45'),
    (new.id, 7, '18:00', '19:15');

  -- app_settings 기본 행
  insert into public.app_settings (user_id) values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

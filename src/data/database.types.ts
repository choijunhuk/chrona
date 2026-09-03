/**
 * DB 타입 — supabase gen types 형식.
 *
 * 수기 작성본 — 2026-08-23 클라우드 스키마(information_schema)와 전 컬럼·nullability
 * 대조 완료. `pnpm types`(supabase gen, Docker 또는 supabase login 필요)로 재생성 가능하며
 * 스키마 변경 시 반드시 재생성·대조할 것.
 * 이 파일은 src/data/ 밖에서 import 금지 (stage-1 §1-5).
 */

type CategoryRow = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
  updated_at: string;
};

type SemesterRow = {
  id: string;
  user_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  updated_at: string;
};

type PeriodPresetRow = {
  id: string;
  user_id: string;
  period_no: number;
  start_time: string;
  end_time: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  memo: string | null;
  category_id: string | null;
  color: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  rrule: string | null;
  rrule_until: string | null;
  due_at: string | null;
  is_done: boolean;
  done_at: string | null;
  semester_id: string | null;
  location: string | null;
  professor: string | null;
  updated_at: string;
  deleted_at: string | null;
};

type EventOverrideRow = {
  id: string;
  event_id: string;
  original_start: string;
  new_start: string | null;
  new_end: string | null;
  is_cancelled: boolean;
  updated_at: string;
};

type ReminderRow = {
  id: string;
  event_id: string;
  offset_minutes: number;
  mode: string;
  sound_key: string;
  vibrate: boolean;
  enabled: boolean;
  updated_at: string;
};

type StandaloneAlarmRow = {
  id: string;
  user_id: string;
  time: string;
  weekdays: number[];
  label: string | null;
  enabled: boolean;
  sound_key: string;
  vibrate: boolean;
  challenge: string; // 0007 — 해제 게이트 'none' | 'math' | 'shake'
  updated_at: string;
  deleted_at: string | null;
};

type FocusSessionRow = {
  id: string;
  user_id: string;
  event_id: string | null;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number;
  completed: boolean;
  updated_at: string;
};

type AppSettingsRow = {
  user_id: string;
  ongoing_enabled: boolean;
  briefing_enabled: boolean;
  briefing_time: string;
  default_reminder_offset: number;
  snooze_minutes: number;
  max_snooze_count: number;
  default_sound_key: string;
  fixed_timezone: string | null;
  theme: string;
  permission_checked_at: string | null;
  updated_at: string;
};

type MeetPollRow = {
  id: string;
  user_id: string;
  title: string;
  dates: string[];
  time_start: string;
  time_end: string;
  slot_minutes: number;
  share_token: string;
  confirmed_start: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type MeetResponseRow = {
  id: string;
  poll_id: string;
  participant_name: string;
  slots: string[];
  client_key: string | null; // 0006 — 브라우저별 이름 선점 키
  updated_at: string;
};

type TableShape<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      categories: TableShape<CategoryRow, 'user_id' | 'name' | 'color'>;
      semesters: TableShape<SemesterRow, 'user_id' | 'name' | 'start_date' | 'end_date'>;
      period_presets: TableShape<
        PeriodPresetRow,
        'user_id' | 'period_no' | 'start_time' | 'end_time'
      >;
      events: TableShape<EventRow, 'user_id' | 'kind' | 'title'>;
      event_overrides: TableShape<EventOverrideRow, 'event_id' | 'original_start'>;
      reminders: TableShape<ReminderRow, 'event_id'>;
      standalone_alarms: TableShape<StandaloneAlarmRow, 'user_id' | 'time'>;
      focus_sessions: TableShape<
        FocusSessionRow,
        'user_id' | 'started_at' | 'planned_minutes'
      >;
      app_settings: TableShape<AppSettingsRow, 'user_id'>;
      meet_polls: TableShape<
        MeetPollRow,
        'user_id' | 'title' | 'dates' | 'time_start' | 'time_end'
      >;
      meet_responses: TableShape<MeetResponseRow, 'poll_id' | 'participant_name'>;
    };
    Views: Record<string, never>;
    Functions: {
      meet_get_poll: { Args: { p_token: string }; Returns: unknown };
      meet_submit_response: {
        // p_client_key는 0006에서 추가된 default null 인자 — 옛 클라이언트도 그대로 동작
        Args: { p_token: string; p_name: string; p_slots: string[]; p_client_key?: string };
        Returns: undefined;
      };
      // 백업 복원 단일 트랜잭션 (0006). payload는 exportBackup이 만든 JSON 그대로
      restore_backup: { Args: { payload: Record<string, unknown> }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

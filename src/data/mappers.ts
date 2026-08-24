/**
 * DB Row ↔ 도메인 타입 매핑 — 유일한 변환 지점 (stage-1 §1-5).
 * "여기가 틀리면 전부 틀린다" → mappers.test.ts 필수.
 *
 * 규칙 (master §7.2):
 * - all_day=true → start_date/end_date만 사용, Date 객체 생성 금지
 * - all_day=false → starts_at/ends_at(UTC ISO)만 사용
 */
import type {
  AppSettings,
  Category,
  ChronaEvent,
  EventKind,
  EventOverride,
  PeriodPreset,
  Reminder,
  ReminderMode,
  StandaloneAlarm,
} from '@/domain/types';
import { asDateOnly, normalizeTimeOfDay } from '@/domain/time';

import type { Database } from './database.types';

type Tables = Database['public']['Tables'];
export type EventRow = Tables['events']['Row'];
export type EventInsert = Tables['events']['Insert'];
export type CategoryRow = Tables['categories']['Row'];
export type ReminderRow = Tables['reminders']['Row'];
export type PeriodPresetRow = Tables['period_presets']['Row'];
export type AppSettingsRow = Tables['app_settings']['Row'];
export type AppSettingsUpdate = Tables['app_settings']['Update'];

const date = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

// ── events ──────────────────────────────────────────────

export function toDomainEvent(row: EventRow): ChronaEvent {
  return {
    id: row.id,
    kind: row.kind as EventKind,
    title: row.title,
    memo: row.memo,
    categoryId: row.category_id,
    color: row.color,
    allDay: row.all_day,
    startsAt: row.all_day ? null : date(row.starts_at),
    endsAt: row.all_day ? null : date(row.ends_at),
    startDate: row.all_day && row.start_date ? asDateOnly(row.start_date) : null,
    endDate: row.all_day && row.end_date ? asDateOnly(row.end_date) : null,
    rrule: row.rrule,
    rruleUntil: date(row.rrule_until),
    dueAt: date(row.due_at),
    isDone: row.is_done,
    doneAt: date(row.done_at),
    semesterId: row.semester_id,
    location: row.location,
    professor: row.professor,
    updatedAt: new Date(row.updated_at),
  };
}

/** 생성/수정 입력 (id·updatedAt 없음) */
export type EventDraft = Omit<ChronaEvent, 'id' | 'updatedAt'>;

export function toEventInsert(draft: EventDraft, userId: string): EventInsert {
  if (draft.allDay) {
    if (!draft.startDate) throw new Error('allDay event requires startDate');
    if (draft.startsAt || draft.endsAt) {
      throw new Error('allDay event must not carry timestamps (master §7.2)');
    }
  } else if (draft.startDate || draft.endDate) {
    throw new Error('timed event must not carry date-only fields (master §7.2)');
  }
  return {
    user_id: userId,
    kind: draft.kind,
    title: draft.title,
    memo: draft.memo,
    category_id: draft.categoryId,
    color: draft.color,
    all_day: draft.allDay,
    starts_at: draft.startsAt ? draft.startsAt.toISOString() : null,
    ends_at: draft.endsAt ? draft.endsAt.toISOString() : null,
    start_date: draft.startDate,
    end_date: draft.endDate,
    rrule: draft.rrule,
    rrule_until: draft.rruleUntil ? draft.rruleUntil.toISOString() : null,
    due_at: draft.dueAt ? draft.dueAt.toISOString() : null,
    is_done: draft.isDone,
    done_at: draft.doneAt ? draft.doneAt.toISOString() : null,
    semester_id: draft.semesterId,
    location: draft.location,
    professor: draft.professor,
    updated_at: new Date().toISOString(), // master §7.3: 변경 시 항상 updated_at 세팅
  };
}

// ── categories ──────────────────────────────────────────

export function toDomainCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
  };
}

// ── reminders ───────────────────────────────────────────

export function toDomainReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    eventId: row.event_id,
    offsetMinutes: row.offset_minutes,
    mode: row.mode as ReminderMode,
    soundKey: row.sound_key,
    vibrate: row.vibrate,
    enabled: row.enabled,
  };
}

// ── event_overrides / standalone_alarms ─────────────────

export type EventOverrideRow = Tables['event_overrides']['Row'];
export type StandaloneAlarmRow = Tables['standalone_alarms']['Row'];
export type StandaloneAlarmInsert = Tables['standalone_alarms']['Insert'];

export function toDomainOverride(row: EventOverrideRow): EventOverride {
  return {
    id: row.id,
    eventId: row.event_id,
    originalStart: new Date(row.original_start),
    newStart: date(row.new_start),
    newEnd: date(row.new_end),
    isCancelled: row.is_cancelled,
  };
}

export function toDomainStandaloneAlarm(row: StandaloneAlarmRow): StandaloneAlarm {
  return {
    id: row.id,
    time: normalizeTimeOfDay(row.time),
    weekdays: row.weekdays,
    label: row.label,
    enabled: row.enabled,
    soundKey: row.sound_key,
    vibrate: row.vibrate,
  };
}

export type StandaloneAlarmDraft = Omit<StandaloneAlarm, 'id'>;

export function toStandaloneAlarmInsert(
  draft: StandaloneAlarmDraft,
  userId: string
): StandaloneAlarmInsert {
  return {
    user_id: userId,
    time: draft.time,
    weekdays: draft.weekdays,
    label: draft.label,
    enabled: draft.enabled,
    sound_key: draft.soundKey,
    vibrate: draft.vibrate,
    updated_at: new Date().toISOString(),
  };
}

// ── reminders (쓰기) ────────────────────────────────────

export type ReminderInsert = Tables['reminders']['Insert'];
export type ReminderDraft = Omit<Reminder, 'id' | 'eventId'>;

export function toReminderInsert(draft: ReminderDraft, eventId: string): ReminderInsert {
  return {
    event_id: eventId,
    offset_minutes: draft.offsetMinutes,
    mode: draft.mode,
    sound_key: draft.soundKey,
    vibrate: draft.vibrate,
    enabled: draft.enabled,
    updated_at: new Date().toISOString(),
  };
}

// ── period_presets ──────────────────────────────────────

export function toDomainPeriodPreset(row: PeriodPresetRow): PeriodPreset {
  return {
    id: row.id,
    periodNo: row.period_no,
    startTime: normalizeTimeOfDay(row.start_time),
    endTime: normalizeTimeOfDay(row.end_time),
  };
}

// ── app_settings ────────────────────────────────────────

export function toDomainSettings(row: AppSettingsRow): AppSettings {
  return {
    briefingEnabled: row.briefing_enabled,
    ongoingEnabled: row.ongoing_enabled,
    briefingTime: normalizeTimeOfDay(row.briefing_time),
    defaultReminderOffset: row.default_reminder_offset,
    snoozeMinutes: row.snooze_minutes,
    maxSnoozeCount: row.max_snooze_count,
    defaultSoundKey: row.default_sound_key,
    fixedTimezone: row.fixed_timezone,
    theme: row.theme,
    permissionCheckedAt: row.permission_checked_at ? new Date(row.permission_checked_at) : null,
  };
}

export function toSettingsUpdate(patch: Partial<AppSettings>): AppSettingsUpdate {
  const u: AppSettingsUpdate = { updated_at: new Date().toISOString() };
  if (patch.briefingEnabled !== undefined) u.briefing_enabled = patch.briefingEnabled;
  if (patch.ongoingEnabled !== undefined) u.ongoing_enabled = patch.ongoingEnabled;
  if (patch.briefingTime !== undefined) u.briefing_time = patch.briefingTime;
  if (patch.defaultReminderOffset !== undefined)
    u.default_reminder_offset = patch.defaultReminderOffset;
  if (patch.snoozeMinutes !== undefined) u.snooze_minutes = patch.snoozeMinutes;
  if (patch.maxSnoozeCount !== undefined) u.max_snooze_count = patch.maxSnoozeCount;
  if (patch.defaultSoundKey !== undefined) u.default_sound_key = patch.defaultSoundKey;
  if (patch.fixedTimezone !== undefined) u.fixed_timezone = patch.fixedTimezone;
  if (patch.theme !== undefined) u.theme = patch.theme;
  if (patch.permissionCheckedAt !== undefined)
    u.permission_checked_at = patch.permissionCheckedAt
      ? patch.permissionCheckedAt.toISOString()
      : null;
  return u;
}

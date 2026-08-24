/**
 * Chrona 도메인 타입 — 앱 전체가 사용하는 형태 (stage-1 §1-5).
 *
 * DB 생성 타입(database.types.ts)은 src/data/ 밖으로 나오지 않는다.
 * 변환은 src/data/mappers.ts 한 곳에서만.
 */
import type { DateOnly } from './time';

export type EventKind = 'schedule' | 'timetable' | 'task';
export type ReminderMode = 'notify' | 'alarm';

export type ChronaEvent = {
  id: string;
  kind: EventKind;
  title: string;
  memo: string | null;
  categoryId: string | null;
  color: string | null; // null이면 category 색 상속 (표시 계층에서 해석)
  // 시각 (master §7.2): allDay면 startDate/endDate만, 아니면 startsAt/endsAt만
  allDay: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  rrule: string | null;
  rruleUntil: Date | null;
  // task
  dueAt: Date | null;
  isDone: boolean;
  doneAt: Date | null;
  // timetable
  semesterId: string | null;
  location: string | null;
  professor: string | null;
  updatedAt: Date;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sortOrder: number;
};

export type Semester = {
  id: string;
  name: string;
  startDate: DateOnly;
  endDate: DateOnly;
  isActive: boolean;
};

export type PeriodPreset = {
  id: string;
  periodNo: number;
  startTime: string; // 'HH:MM'
  endTime: string;
};

export type EventOverride = {
  id: string;
  eventId: string;
  originalStart: Date;
  newStart: Date | null;
  newEnd: Date | null;
  isCancelled: boolean;
};

export type Reminder = {
  id: string;
  eventId: string;
  offsetMinutes: number;
  mode: ReminderMode;
  soundKey: string;
  vibrate: boolean;
  enabled: boolean;
};

export type StandaloneAlarm = {
  id: string;
  time: string; // 'HH:MM'
  weekdays: number[]; // 0=일 ~ 6=토. 빈 배열이면 1회성
  label: string | null;
  enabled: boolean;
  soundKey: string;
  vibrate: boolean;
};

export type FocusSession = {
  id: string;
  eventId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  plannedMinutes: number;
  completed: boolean;
};

export type AppSettings = {
  briefingEnabled: boolean;
  briefingTime: string; // 'HH:MM'
  defaultReminderOffset: number;
  snoozeMinutes: number;
  maxSnoozeCount: number;
  defaultSoundKey: string;
  fixedTimezone: string | null; // null = 기기 시간대 (master §7.2)
  theme: string;
  permissionCheckedAt: Date | null;
};

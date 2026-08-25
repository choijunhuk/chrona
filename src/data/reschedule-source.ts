/**
 * 재계산 소스 스냅샷 (stage-3 §1-3의 "로컬 캐시").
 *
 * 재계산은 headless 컨텍스트(부팅/자정 앵커)에서도 돌아야 하므로 네트워크·TanStack에
 * 의존할 수 없다. 온라인일 때 전 데이터를 이 스냅샷에 내려두고, 재계산은 여기서만 읽는다.
 * Date는 ISO 문자열로 저장하고 읽을 때 리바이브한다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  AppSettings,
  ChronaEvent,
  EventOverride,
  Reminder,
  StandaloneAlarm,
} from '@/domain/types';

import type {
  AppSettingsRow,
  EventOverrideRow,
  EventRow,
  ReminderRow,
  StandaloneAlarmRow,
} from './mappers';
import {
  toDomainEvent,
  toDomainOverride,
  toDomainReminder,
  toDomainSettings,
  toDomainStandaloneAlarm,
} from './mappers';
import { supabase } from './supabase';

const KEY = 'chrona.reschedule-source';

export type RescheduleSource = {
  events: ChronaEvent[];
  overrides: EventOverride[];
  reminders: Reminder[];
  standaloneAlarms: StandaloneAlarm[];
  settings: AppSettings | null;
  syncedAt: string;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** 서버에서 전 데이터 당겨서 스냅샷 갱신. 오프라인이면 조용히 실패 (기존 스냅샷 유지) */
export async function refreshRescheduleSource(): Promise<RescheduleSource | null> {
  try {
    const [events, overrides, reminders, alarms, settings] = await Promise.all([
      supabase.from('events').select('*').is('deleted_at', null),
      supabase.from('event_overrides').select('*'),
      supabase.from('reminders').select('*'),
      supabase.from('standalone_alarms').select('*').is('deleted_at', null),
      supabase.from('app_settings').select('*').maybeSingle(),
    ]);
    if (events.error || overrides.error || reminders.error || alarms.error || settings.error) {
      return null;
    }
    const source: RescheduleSource = {
      events: (events.data as EventRow[]).map(toDomainEvent),
      overrides: (overrides.data as EventOverrideRow[]).map(toDomainOverride),
      reminders: (reminders.data as ReminderRow[]).map(toDomainReminder),
      standaloneAlarms: (alarms.data as StandaloneAlarmRow[]).map(toDomainStandaloneAlarm),
      settings: settings.data ? toDomainSettings(settings.data as AppSettingsRow) : null,
      syncedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(KEY, JSON.stringify(source));
    return source;
  } catch {
    return null;
  }
}

/** 스냅샷 읽기 (headless 안전). 없으면 null */
export async function readRescheduleSource(): Promise<RescheduleSource | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw, (k, v) =>
      k !== 'syncedAt' && typeof v === 'string' && ISO_RE.test(v) ? new Date(v) : v
    ) as RescheduleSource;
  } catch {
    return null;
  }
}

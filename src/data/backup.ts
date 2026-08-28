/**
 * 백업/복원 (stage-8 §4). 개인용 앱의 생명줄 — Supabase 무료 티어는 일시정지될 수 있다.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fromZonedTime } from 'date-fns-tz';

import { parseIcs, type IcsDateTime } from '@/domain/ics';

import { supabase } from './supabase';

const SCHEMA_VERSION = 1;
const TABLES = [
  'categories',
  'semesters',
  'period_presets',
  'events',
  'event_overrides',
  'reminders',
  'standalone_alarms',
  'focus_sessions',
  'app_settings',
] as const;

type Backup = {
  app: 'chrona';
  schemaVersion: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
};

async function buildBackup(): Promise<Backup> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const { data: rows, error } = await supabase.from(t).select('*');
    if (error) throw error;
    data[t] = rows ?? [];
  }
  return { app: 'chrona', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
}

/** 전체 데이터 → JSON 파일 → 공유 시트 */
export async function exportBackup(): Promise<string> {
  const backup = await buildBackup();
  const name = `chrona-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
  const file = new File(Paths.cache, name);
  file.write(JSON.stringify(backup));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
  return name;
}

const AUTO_BACKUP_KEY = 'chrona.last-auto-backup';
const AUTO_BACKUP_INTERVAL = 7 * 86400_000;

/**
 * 자동 로컬 백업 (stage-11): 주 1회, 포그라운드 진입 시. Supabase 무료 티어
 * 일시정지/유실 대비 — 앱 문서 폴더에 최신 1개 + 직전 1개를 남긴다.
 * 실패는 조용히 무시 (오프라인·미로그인은 정상 상황).
 */
export async function autoBackupIfDue(): Promise<boolean> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const last = await AsyncStorage.getItem(AUTO_BACKUP_KEY);
    if (last && Date.now() - new Date(last).getTime() < AUTO_BACKUP_INTERVAL) return false;
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) return false;

    const backup = await buildBackup();
    const latest = new File(Paths.document, 'chrona-auto-backup.json');
    const prev = new File(Paths.document, 'chrona-auto-backup.prev.json');
    if (latest.exists) {
      if (prev.exists) prev.delete();
      latest.copy(prev);
    }
    latest.write(JSON.stringify(backup));
    await AsyncStorage.setItem(AUTO_BACKUP_KEY, new Date().toISOString());
    console.log('[chrona] auto backup written');
    return true;
  } catch (e) {
    console.warn('[chrona] auto backup skipped:', e);
    return false;
  }
}

/** JSON 가져오기 — 스키마 버전 검증 후 테이블별 upsert (id 충돌 시 교체) */
export async function importBackup(): Promise<{ restored: number } | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
  if (picked.canceled || !picked.assets[0]) return null;
  const file = new File(picked.assets[0].uri);
  // 크기 캡 — 비정상 파일 파싱 방지 (개인 백업은 수백 KB 수준)
  if ((file.size ?? 0) > 20 * 1024 * 1024) throw new Error('백업 파일이 너무 큽니다 (20MB 초과)');
  const parsed = JSON.parse(file.textSync()) as Backup;
  if (parsed.app !== 'chrona') throw new Error('Chrona 백업 파일이 아닙니다');
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`스키마 버전 불일치 (파일 v${parsed.schemaVersion}, 앱 v${SCHEMA_VERSION})`);
  }
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) throw new Error('로그인 필요');
  const uid = s.session.user.id;

  let restored = 0;
  // FK 순서대로 (부모 → 자식)
  for (const t of TABLES) {
    const rows = (parsed.data[t] ?? []) as Record<string, unknown>[];
    if (rows.length === 0) continue;
    // user_id를 현재 계정으로 교체 (다른 계정 백업도 복원 가능하게)
    const patched = rows.map((r) => ('user_id' in r ? { ...r, user_id: uid } : r));
    const conflictKey = t === 'app_settings' ? 'user_id' : 'id';
    const { error } = await supabase.from(t).upsert(patched as never[], { onConflict: conflictKey });
    if (error) throw new Error(`${t} 복원 실패: ${error.message}`);
    restored += rows.length;
  }
  return { restored };
}

// ─── .ics 가져오기 (stage-11) ───────────────────────────

function icsToDate(dt: IcsDateTime, tz: string): Date {
  const iso = `${dt.date}T${dt.time ?? '00:00:00'}`;
  return dt.utc ? new Date(`${iso}Z`) : fromZonedTime(iso, tz);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** .ics 파일 선택 → 파싱 → events 일괄 삽입 (kind='schedule'). 취소 시 null */
export async function importIcs(): Promise<{ imported: number } | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['text/calendar', 'application/octet-stream', '*/*'],
  });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  if (!asset.name.toLowerCase().endsWith('.ics')) throw new Error('.ics 파일이 아닙니다');
  const file = new File(asset.uri);
  if ((file.size ?? 0) > 20 * 1024 * 1024) throw new Error('파일이 너무 큽니다 (20MB 초과)');

  const parsed = parseIcs(file.textSync());
  if (parsed.length === 0) throw new Error('가져올 일정이 없습니다');

  const { data: s } = await supabase.auth.getSession();
  if (!s.session) throw new Error('로그인 필요');
  const uid = s.session.user.id;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nowIso = new Date().toISOString();

  const rows = parsed.map((e) => {
    const allDay = e.start.time === null;
    // DTEND;VALUE=DATE는 exclusive (RFC 5545) → 하루 빼고 시작일 밑으로는 내려가지 않게
    const endDate = e.end?.date
      ? (() => {
          const d = shiftDate(e.end!.date, -1);
          return d < e.start.date ? e.start.date : d;
        })()
      : e.start.date;
    return {
      user_id: uid,
      kind: 'schedule',
      title: e.title,
      memo: e.memo,
      location: e.location,
      all_day: allDay,
      start_date: allDay ? e.start.date : null,
      end_date: allDay ? endDate : null,
      starts_at: allDay ? null : icsToDate(e.start, tz).toISOString(),
      ends_at: allDay
        ? null
        : e.end
          ? icsToDate(e.end, tz).toISOString()
          : new Date(icsToDate(e.start, tz).getTime() + 3600_000).toISOString(),
      rrule: e.rrule,
      rrule_until: e.rruleUntil ? icsToDate(e.rruleUntil, tz).toISOString() : null,
      category_id: null,
      color: null,
      is_done: false,
      updated_at: nowIso,
    };
  });

  const { error } = await supabase.from('events').insert(rows as never[]);
  if (error) throw new Error(`가져오기 실패: ${error.message}`);
  return { imported: rows.length };
}

/** .ics 내보내기 (stage-8 §4-3). 종일은 VALUE=DATE, rrule 그대로 */
export async function exportIcs(): Promise<void> {
  const { data: rows, error } = await supabase
    .from('events')
    .select('*')
    .is('deleted_at', null);
  if (error) throw error;

  const fmtDT = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fmtD = (d: string) => d.replace(/-/g, '');

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//chrona//KR'];
  for (const e of rows as {
    id: string;
    title: string;
    memo: string | null;
    all_day: boolean;
    start_date: string | null;
    end_date: string | null;
    starts_at: string | null;
    ends_at: string | null;
    rrule: string | null;
    rrule_until: string | null;
    location: string | null;
    kind: string;
    due_at: string | null;
  }[]) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@chrona`, `SUMMARY:${e.title.replace(/\n/g, ' ')}`);
    if (e.all_day && e.start_date) {
      lines.push(`DTSTART;VALUE=DATE:${fmtD(e.start_date)}`);
      if (e.end_date) lines.push(`DTEND;VALUE=DATE:${fmtD(e.end_date)}`);
    } else if (e.starts_at) {
      lines.push(`DTSTART:${fmtDT(e.starts_at)}`);
      if (e.ends_at) lines.push(`DTEND:${fmtDT(e.ends_at)}`);
    } else if (e.kind === 'task' && e.due_at) {
      lines.push(`DTSTART:${fmtDT(e.due_at)}`);
    } else {
      lines.push('DTSTART;VALUE=DATE:19700101');
    }
    if (e.rrule) {
      const until = e.rrule_until ? `;UNTIL=${fmtDT(e.rrule_until)}` : '';
      lines.push(`RRULE:${e.rrule}${until}`);
    }
    if (e.location) lines.push(`LOCATION:${e.location}`);
    if (e.memo) lines.push(`DESCRIPTION:${e.memo.replace(/\n/g, '\\n')}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  const file = new File(Paths.cache, 'chrona-export.ics');
  file.write(lines.join('\r\n'));
  await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar' });
}

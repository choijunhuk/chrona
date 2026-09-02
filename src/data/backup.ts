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
/** 사용자가 고른 SAF 폴더 URI. 없으면 외부 사본을 남기지 않는다 */
const BACKUP_DIR_KEY = 'chrona.backup-dir';
const AUTO_BACKUP_BASE = 'chrona-auto-backup';
const AUTO_BACKUP_FILE = `${AUTO_BACKUP_BASE}.json`;
const AUTO_BACKUP_PREV_FILE = `${AUTO_BACKUP_BASE}.prev.json`;

/**
 * 백업 폴더 선택 (stage-13). Paths.document는 앱 삭제와 함께 사라지고 DocumentPicker로
 * 열 수도 없다 — SAF로 사용자가 고른 폴더에 사본을 하나 더 남긴다.
 * 권한 요청은 반드시 화면(설정)에서만. headless 자동 백업은 절대 이 함수를 부르지 않는다.
 * @returns 선택된 폴더 URI, 취소하면 null (Android 전용)
 */
export async function chooseBackupDirectory(): Promise<string | null> {
  const { StorageAccessFramework } = await import('expo-file-system/legacy');
  const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!perm.granted) return null;
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem(BACKUP_DIR_KEY, perm.directoryUri);
  return perm.directoryUri;
}

/** 저장된 SAF 폴더가 있을 때만 사본을 쓴다. 실패해도 내부 백업은 성공으로 친다 */
async function copyToBackupDirectory(json: string): Promise<void> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  const dir = await AsyncStorage.getItem(BACKUP_DIR_KEY);
  if (!dir) return;
  try {
    const { StorageAccessFramework: SAF } = await import('expo-file-system/legacy');
    // 같은 이름이 있으면 SAF가 'chrona-auto-backup (1).json'을 새로 만든다 → 먼저 지운다
    const entries = await SAF.readDirectoryAsync(dir);
    const dup = entries.find((u) => decodeURIComponent(u).endsWith(`/${AUTO_BACKUP_FILE}`));
    if (dup) await SAF.deleteAsync(dup);
    const uri = await SAF.createFileAsync(dir, AUTO_BACKUP_BASE, 'application/json');
    await SAF.writeAsStringAsync(uri, json);
  } catch (e) {
    // 폴더 권한이 회수됐거나 SD카드가 빠진 경우 — 내부 백업은 이미 남았다
    console.warn('[chrona] backup dir copy skipped:', e);
  }
}

/**
 * 자동 로컬 백업 (stage-11): 주 1회, 포그라운드 진입 시. Supabase 무료 티어
 * 일시정지/유실 대비 — 앱 문서 폴더에 최신 1개 + 직전 1개를 남긴다.
 * stage-13: 사용자가 폴더를 지정해 뒀으면 그곳에도 사본을 하나 더 남긴다 (앱 삭제 생존).
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
    const json = JSON.stringify(backup);
    const latest = new File(Paths.document, AUTO_BACKUP_FILE);
    const prev = new File(Paths.document, AUTO_BACKUP_PREV_FILE);
    if (latest.exists) {
      if (prev.exists) prev.delete();
      latest.copy(prev);
    }
    latest.write(json);
    await copyToBackupDirectory(json);
    await AsyncStorage.setItem(AUTO_BACKUP_KEY, new Date().toISOString());
    console.log('[chrona] auto backup written');
    return true;
  } catch (e) {
    console.warn('[chrona] auto backup skipped:', e);
    return false;
  }
}

function parseBackup(text: string): Backup {
  const parsed = JSON.parse(text) as Backup;
  if (parsed.app !== 'chrona') throw new Error('Chrona 백업 파일이 아닙니다');
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`스키마 버전 불일치 (파일 v${parsed.schemaVersion}, 앱 v${SCHEMA_VERSION})`);
  }
  if (!parsed.data || typeof parsed.data !== 'object') throw new Error('백업 내용이 비어 있습니다');
  return parsed;
}

/**
 * 복원은 서버 트랜잭션 하나 (stage-13, 0006 restore_backup).
 * 테이블별 upsert를 돌리면 중간에 실패했을 때 반쯤 복원된 상태가 남는다.
 * user_id는 RPC가 auth.uid()로 덮어쓰므로 페이로드는 그대로 올린다.
 */
async function restoreViaRpc(parsed: Backup): Promise<{ restored: number }> {
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) throw new Error('로그인 필요');
  const { error } = await supabase.rpc('restore_backup', { payload: parsed });
  if (error) throw new Error(`복원 실패: ${error.message}`);
  const restored = TABLES.reduce((n, t) => n + (parsed.data[t]?.length ?? 0), 0);
  return { restored };
}

/** JSON 가져오기 — 스키마 버전 검증 후 restore_backup RPC 한 번 (단일 트랜잭션) */
export async function importBackup(): Promise<{ restored: number } | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
  if (picked.canceled || !picked.assets[0]) return null;
  const file = new File(picked.assets[0].uri);
  // 크기 캡 — 비정상 파일 파싱 방지 (개인 백업은 수백 KB 수준)
  if ((file.size ?? 0) > 20 * 1024 * 1024) throw new Error('백업 파일이 너무 큽니다 (20MB 초과)');
  return restoreViaRpc(parseBackup(file.textSync()));
}

/**
 * 자동 백업에서 복원 (stage-13). 자동 백업은 앱 내부 폴더에 있어 DocumentPicker로
 * 고를 수 없다 — 파일을 직접 읽는다. 최신본이 깨졌으면 직전본으로 넘어간다.
 */
export async function restoreFromAutoBackup(): Promise<{ restored: number; exportedAt: string }> {
  const candidates = [
    new File(Paths.document, AUTO_BACKUP_FILE),
    new File(Paths.document, AUTO_BACKUP_PREV_FILE),
  ].filter((f) => f.exists);
  if (candidates.length === 0) throw new Error('자동 백업 파일이 없습니다');

  let lastError: unknown = null;
  for (const file of candidates) {
    try {
      const parsed = parseBackup(file.textSync());
      const { restored } = await restoreViaRpc(parsed);
      return { restored, exportedAt: parsed.exportedAt };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('자동 백업 복원 실패');
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

/**
 * 시각 처리 유틸 — master §7.2를 코드로 강제한다 (stage-1 §1-6).
 *
 * 규칙:
 * - 종일 일정은 절대 Date/timestamp로 다루지 않는다 → DateOnly 브랜디드 타입
 * - 모든 시각 포맷은 이 모듈을 통한다. 화면에서 toLocaleString 직접 호출 금지
 * - fixedTimezone이 설정돼 있으면 기기 시간대 무시하고 그 시간대 기준 표시
 */
import { format } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** 'YYYY-MM-DD'. 브랜드로 일반 string과 구분 — timestamp 변환 사고 방지 */
export type DateOnly = string & { readonly __brand: 'DateOnly' };

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(s: string): s is DateOnly {
  return DATE_ONLY_RE.test(s);
}

export function asDateOnly(s: string): DateOnly {
  if (!isDateOnly(s)) {
    throw new Error(`Invalid DateOnly: ${s}`);
  }
  return s;
}

/** Date → 해당 시간대 기준 'YYYY-MM-DD' */
export function toDateOnly(d: Date, tz: string): DateOnly {
  return formatInTimeZone(d, tz, 'yyyy-MM-dd') as DateOnly;
}

/** 'YYYY-MM-DD' → 해당 시간대의 그날 00:00 (캘린더 배치 계산용) */
export function fromDateOnly(s: DateOnly, tz: string): Date {
  return fromZonedTime(`${s}T00:00:00`, tz);
}

/** '오후 9:00' — 알람 payload용 포맷 (master §3.5) */
export function formatTimeLabel(d: Date, tz?: string): string {
  const h = tz ? Number(formatInTimeZone(d, tz, 'H')) : d.getHours();
  const m = tz ? Number(formatInTimeZone(d, tz, 'm')) : d.getMinutes();
  const meridiem = h < 12 ? '오전' : '오후';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${meridiem} ${hour12}:${String(m).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD (요일)' 등 날짜 라벨 */
export function formatDateLabel(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, 'yyyy-MM-dd');
}

/** fixedTimezone 설정이 있으면 그것, 없으면 기기 시간대 (master §7.2) */
export function resolveTimezone(settings: { fixedTimezone: string | null } | null): string {
  if (settings?.fixedTimezone) return settings.fixedTimezone;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** ISO 문자열 ↔ Date — 매퍼에서 사용 */
export function parseTimestamp(iso: string): Date {
  return new Date(iso);
}

export function toTimestamp(d: Date): string {
  return d.toISOString();
}

/** 'HH:MM[:SS]' → 'HH:MM' 정규화 (Postgres time 컬럼 왕복용) */
export function normalizeTimeOfDay(t: string): string {
  return t.slice(0, 5);
}

/** 로컬 개념 없는 순수 날짜 연산이 필요할 때 사용 (도메인 내부용) */
export function todayDateOnly(tz: string): DateOnly {
  return toDateOnly(new Date(), tz);
}

export { format as formatRaw };

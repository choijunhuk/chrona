/**
 * 반복 설정 UI ↔ rrule 문자열 직렬화/역파싱 (stage-5 §1-4).
 * 지원 범위: 안 함/매일/매주(요일)/격주(요일)/매월(날짜) + 종료(없음/날짜/N회).
 * 그 이상(INTERVAL>2, n번째 요일 등)은 만들지 않는다.
 */
export type RepeatFreq = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export type RepeatConfig = {
  freq: RepeatFreq;
  /** weekly/biweekly: 0=일 ~ 6=토 (DB 규약과 동일) */
  weekdays: number[];
  /** 종료: null=없음 */
  count: number | null;
};

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const KO_DAY = ['일', '월', '화', '수', '목', '금', '토'];

/** RepeatConfig → rrule 문자열 (none이면 null) */
export function toRRuleString(cfg: RepeatConfig): string | null {
  if (cfg.freq === 'none') return null;
  const parts: string[] = [];
  if (cfg.freq === 'daily') parts.push('FREQ=DAILY');
  if (cfg.freq === 'weekly') parts.push('FREQ=WEEKLY');
  if (cfg.freq === 'biweekly') parts.push('FREQ=WEEKLY', 'INTERVAL=2');
  if (cfg.freq === 'monthly') parts.push('FREQ=MONTHLY');
  if ((cfg.freq === 'weekly' || cfg.freq === 'biweekly') && cfg.weekdays.length > 0) {
    parts.push(`BYDAY=${[...cfg.weekdays].sort().map((d) => BYDAY[d]).join(',')}`);
  }
  if (cfg.count) parts.push(`COUNT=${cfg.count}`);
  return parts.join(';');
}

/** rrule 문자열 → RepeatConfig (역파싱 — 검증 11). 지원 밖 규칙은 그대로 두고 custom 취급 */
export function fromRRuleString(rrule: string | null): RepeatConfig | 'custom' {
  if (!rrule) return { freq: 'none', weekdays: [], count: null };
  const map = new Map(
    rrule
      .replace(/^RRULE:/, '')
      .split(';')
      .map((kv) => kv.split('=') as [string, string])
  );
  const freq = map.get('FREQ');
  const interval = Number(map.get('INTERVAL') ?? '1');
  const count = map.get('COUNT') ? Number(map.get('COUNT')) : null;
  const weekdays = (map.get('BYDAY')?.split(',') ?? [])
    .map((d) => BYDAY.indexOf(d))
    .filter((i) => i >= 0);

  const unsupported = ['UNTIL', 'BYMONTHDAY', 'BYSETPOS', 'BYMONTH'].some((k) => map.has(k));
  if (unsupported) return 'custom';

  if (freq === 'DAILY' && interval === 1) return { freq: 'daily', weekdays: [], count };
  if (freq === 'WEEKLY' && interval === 1) return { freq: 'weekly', weekdays, count };
  if (freq === 'WEEKLY' && interval === 2) return { freq: 'biweekly', weekdays, count };
  if (freq === 'MONTHLY' && interval === 1) return { freq: 'monthly', weekdays: [], count };
  return 'custom';
}

/** 자연어 미리보기: "매주 화, 목 · 10회" */
export function describeRepeat(cfg: RepeatConfig): string {
  if (cfg.freq === 'none') return '반복 안 함';
  const base =
    cfg.freq === 'daily'
      ? '매일'
      : cfg.freq === 'monthly'
        ? '매월 같은 날'
        : `${cfg.freq === 'biweekly' ? '격주' : '매주'}${
            cfg.weekdays.length > 0
              ? ' ' + [...cfg.weekdays].sort().map((d) => KO_DAY[d]).join(', ')
              : ''
          }`;
  return cfg.count ? `${base} · ${cfg.count}회` : base;
}

/**
 * 자연어 빠른 추가 파서 — 규칙 기반(정규식 + 날짜 연산), 외부 API 호출 없음.
 *
 * "내일 오후 3시 팀플" → { title: '팀플', start: 내일 15:00 }
 * "다음주 월요일 과제 제출" → { title: '과제 제출', 종일 }
 * 날짜·시간 토큰을 떼어내고 남은 텍스트가 제목이 된다.
 */
import { formatInTimeZone } from 'date-fns-tz';

import { asDateOnly, fromDateOnly, toDateOnly, type DateOnly } from './time';

export type QuickAddResult = {
  title: string;
  allDay: boolean;
  /** allDay=false일 때만. UTC Date */
  start: Date | null;
  /** allDay=true일 때만 */
  startDate: DateOnly | null;
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** DateOnly 캘린더 날짜에 일수 더하기 (tz 무관 — 순수 날짜 연산) */
function addDays(d: DateOnly, days: number): DateOnly {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return asDateOnly(t.toISOString().slice(0, 10));
}

/** 캘린더 날짜의 요일 (0=일). tz 무관 */
function weekdayOf(d: DateOnly): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}

type DateMatch = { date: DateOnly; consumed: string };
type TimeMatch = { hour: number; minute: number; consumed: string };

function matchDate(text: string, today: DateOnly): DateMatch | null {
  let m = /(오늘|내일|모레|글피)/.exec(text);
  if (m) {
    const offset = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 }[m[1]]!;
    return { date: addDays(today, offset), consumed: m[0] };
  }

  m = /(다다음\s*주|다음\s*주|이번\s*주)?\s*([일월화수목금토])요일/.exec(text);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    const todayW = weekdayOf(today);
    let diff: number;
    if (m[1] && !m[1].startsWith('이번')) {
      // 다음주/다다음주 X요일 = 다음(다다음) 월요일로 시작하는 주의 X요일
      const toNextMonday = ((1 - todayW + 7) % 7) || 7;
      diff = toNextMonday + ((target - 1 + 7) % 7) + (m[1].startsWith('다다음') ? 7 : 0);
    } else {
      // (이번주) X요일 = 다가오는 X요일. 오늘이 X요일이면 다음주
      diff = (target - todayW + 7) % 7 || 7;
    }
    return { date: addDays(today, diff), consumed: m[0] };
  }

  m = /(\d{1,2})월\s*(\d{1,2})일/.exec(text);
  if (m) {
    const year = Number(today.slice(0, 4));
    const mk = (y: number) =>
      asDateOnly(`${y}-${String(Number(m![1])).padStart(2, '0')}-${String(Number(m![2])).padStart(2, '0')}`);
    let date = mk(year);
    if (date < today) date = mk(year + 1); // 지난 날짜면 내년
    return { date, consumed: m[0] };
  }

  return null;
}

function matchTime(text: string): TimeMatch | null {
  let m = /(오전|오후|아침|저녁|밤)?\s*(\d{1,2})시\s*(반|(\d{1,2})분)?/.exec(text);
  if (m) {
    let hour = Number(m[2]) % 24;
    const minute = m[3] === '반' ? 30 : m[4] ? Number(m[4]) : 0;
    const meridiem = m[1];
    if ((meridiem === '오후' || meridiem === '저녁' || meridiem === '밤') && hour < 12) hour += 12;
    // ponytail: 수식어 없는 1~7시는 오후로 추정 — "3시 회의"는 보통 15시다
    if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
    return { hour, minute, consumed: m[0] };
  }

  m = /(\d{1,2}):(\d{2})/.exec(text);
  if (m) {
    return { hour: Number(m[1]) % 24, minute: Number(m[2]) % 60, consumed: m[0] };
  }
  return null;
}

/**
 * 파싱 실패(제목 없음)면 null. 날짜·시간이 하나도 없으면 오늘 종일로 취급.
 * 시간만 있고 그 시각이 이미 지났으면 내일로 넘긴다.
 */
export function parseQuickAdd(input: string, now: Date, tz: string): QuickAddResult | null {
  let text = input.trim();
  if (!text) return null;

  const today = toDateOnly(now, tz);
  const dateM = matchDate(text, today);
  if (dateM) text = text.replace(dateM.consumed, ' ');
  const timeM = matchTime(text);
  if (timeM) text = text.replace(timeM.consumed, ' ');

  const title = text.replace(/\s+/g, ' ').trim();
  if (!title) return null;

  if (!timeM) {
    return { title, allDay: true, start: null, startDate: dateM?.date ?? today };
  }

  let date = dateM?.date ?? today;
  let start = new Date(
    fromDateOnly(date, tz).getTime() + timeM.hour * 3600_000 + timeM.minute * 60_000
  );
  if (!dateM && start.getTime() <= now.getTime()) {
    date = addDays(date, 1);
    start = new Date(
      fromDateOnly(date, tz).getTime() + timeM.hour * 3600_000 + timeM.minute * 60_000
    );
  }
  return { title, allDay: false, start, startDate: null };
}

/** 미리보기 라벨 — 입력 중 파싱 결과 확인용 ("내일(금) 오후 3:00") */
export function quickAddPreview(r: QuickAddResult, tz: string): string {
  if (r.allDay) return `${r.startDate} (${WEEKDAYS[weekdayOf(r.startDate!)]}) 종일`;
  const d = toDateOnly(r.start!, tz);
  return `${d} (${WEEKDAYS[weekdayOf(d)]}) ${formatInTimeZone(r.start!, tz, 'HH:mm')}`;
}

/**
 * .ics(RFC 5545) 가져오기 파서 — 내보내기(backup.ts exportIcs)의 역방향.
 *
 * 순수 파서: 파일 텍스트 → 구조화된 VEVENT 목록. Date 변환은 호출측(data 계층)에서.
 * 지원 범위: SUMMARY / DTSTART / DTEND / RRULE / LOCATION / DESCRIPTION.
 * ponytail: TZID 파라미터는 무시하고 floating(로컬)으로 취급 — 개인용 가져오기에서
 * 구글/학사일정 파일 대부분이 Z(UTC) 또는 VALUE=DATE라 충분하다.
 */

/** 파싱된 시각 — 캘린더 좌표만 담고 Date 변환은 하지 않는다 (master §7.2) */
export type IcsDateTime = {
  date: string; // 'YYYY-MM-DD'
  time: string | null; // 'HH:MM:SS', null이면 종일(VALUE=DATE)
  utc: boolean; // 값 끝의 Z 여부
};

export type IcsParsedEvent = {
  title: string;
  memo: string | null;
  location: string | null;
  rrule: string | null; // UNTIL 제거된 규칙 본문
  rruleUntil: IcsDateTime | null;
  start: IcsDateTime;
  end: IcsDateTime | null;
};

const DT_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/;

function parseDateTime(value: string): IcsDateTime | null {
  const m = DT_RE.exec(value.trim());
  if (!m) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[4] ? `${m[4]}:${m[5]}:${m[6]}` : null,
    utc: m[7] === 'Z',
  };
}

/** TEXT 값 이스케이프 해제 (RFC 5545 §3.3.11) */
function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** RRULE에서 UNTIL만 분리 — DB는 rrule 본문과 rrule_until을 따로 저장한다 */
function splitRrule(value: string): { rule: string; until: IcsDateTime | null } {
  const parts = value.split(';');
  let until: IcsDateTime | null = null;
  const rest = parts.filter((p) => {
    if (p.toUpperCase().startsWith('UNTIL=')) {
      until = parseDateTime(p.slice(6));
      return false;
    }
    return true;
  });
  return { rule: rest.join(';'), until };
}

/** ics 텍스트 → VEVENT 목록. 손상된 VEVENT는 건너뛴다 (제목·시작 없는 항목 등) */
export function parseIcs(text: string): IcsParsedEvent[] {
  // 접힌 줄 펼치기: CRLF + 공백/탭 이 이어붙임 표시 (RFC 5545 §3.1)
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const events: IcsParsedEvent[] = [];
  let cur: Partial<IcsParsedEvent> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur?.title && cur.start) {
        events.push({
          title: cur.title,
          memo: cur.memo ?? null,
          location: cur.location ?? null,
          rrule: cur.rrule ?? null,
          rruleUntil: cur.rruleUntil ?? null,
          start: cur.start,
          end: cur.end ?? null,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [nameWithParams, value] = [line.slice(0, colon), line.slice(colon + 1)];
    const name = nameWithParams.split(';')[0].toUpperCase();

    switch (name) {
      case 'SUMMARY':
        cur.title = unescapeText(value).trim();
        break;
      case 'DESCRIPTION':
        cur.memo = unescapeText(value);
        break;
      case 'LOCATION':
        cur.location = unescapeText(value).trim() || null;
        break;
      case 'DTSTART':
        cur.start = parseDateTime(value) ?? undefined;
        break;
      case 'DTEND':
        cur.end = parseDateTime(value) ?? undefined;
        break;
      case 'RRULE': {
        const { rule, until } = splitRrule(value);
        cur.rrule = rule;
        cur.rruleUntil = until;
        break;
      }
    }
  }
  return events;
}

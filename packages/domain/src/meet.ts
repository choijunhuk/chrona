/**
 * 약속 잡기(when2meet) 도메인 로직 (stage-12) — 순수, 앱·웹 공유.
 * 슬롯 키 형식: 'YYYY-MM-DDTHH:MM' (폴의 로컬 캘린더 좌표 — tz 변환 없음.
 * 참여자 전원이 같은 벽시계 시간을 보는 것이 when2meet의 규약이다)
 */

export type MeetPollInfo = {
  title: string;
  dates: string[]; // 'YYYY-MM-DD'
  timeStart: string; // 'HH:MM' 또는 'HH:MM:SS'
  timeEnd: string;
  slotMinutes: number;
  confirmedStart: string | null;
  responses: MeetResponse[];
};

export type MeetResponse = {
  name: string;
  slots: string[];
};

const hhmm = (t: string) => t.slice(0, 5);

function toMinutes(t: string): number {
  const [h, m] = hhmm(t).split(':').map(Number);
  return h * 60 + m;
}

function toTimeLabel(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 폴 하루의 시간 슬롯 라벨 목록 ('09:00', '09:30', …) — 그리드 행 */
export function timeSlots(timeStart: string, timeEnd: string, slotMinutes: number): string[] {
  const out: string[] = [];
  for (let m = toMinutes(timeStart); m < toMinutes(timeEnd); m += slotMinutes) {
    out.push(toTimeLabel(m));
  }
  return out;
}

export function slotKey(date: string, time: string): string {
  return `${date}T${hhmm(time)}`;
}

/** 폴 전체 슬롯 키 (날짜 × 시간) */
export function allSlotKeys(poll: Pick<MeetPollInfo, 'dates' | 'timeStart' | 'timeEnd' | 'slotMinutes'>): string[] {
  const times = timeSlots(poll.timeStart, poll.timeEnd, poll.slotMinutes);
  return poll.dates.flatMap((d) => times.map((t) => slotKey(d, t)));
}

/** 슬롯 키 → 가능한 사람 이름 배열 */
export function heatmap(responses: MeetResponse[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of responses) {
    for (const s of r.slots) {
      const cur = map.get(s);
      if (cur) cur.push(r.name);
      else map.set(s, [r.name]);
    }
  }
  return map;
}

export type RankedSlot = { key: string; count: number; names: string[] };

/** 겹침 많은 순 (동률이면 이른 시각). limit 기본 5 */
export function bestSlots(map: Map<string, string[]>, limit = 5): RankedSlot[] {
  return [...map.entries()]
    .map(([key, names]) => ({ key, count: names.length, names }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
    .slice(0, limit);
}

/** 'YYYY-MM-DDTHH:MM' 슬롯 키 → 표시 라벨 ('9/1 (화) 15:00') */
export function slotLabel(key: string): string {
  const [date, time] = key.split('T');
  const [, m, d] = date.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${m}/${d} (${weekday}) ${time}`;
}

/** '오후 9:05' 형태의 표시용 시각 라벨. 예약 시점에 미리 포맷해 payload에 담는다 (마스터 §3.5). */
export function formatTimeLabel(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const meridiem = h < 12 ? '오전' : '오후';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${meridiem} ${hour12}:${String(m).padStart(2, '0')}`;
}

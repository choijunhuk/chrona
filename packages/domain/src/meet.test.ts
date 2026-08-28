import { describe, expect, it } from 'vitest';

import { allSlotKeys, bestSlots, heatmap, slotLabel, timeSlots } from './meet';

const POLL = {
  dates: ['2026-09-01', '2026-09-02'],
  timeStart: '09:00:00',
  timeEnd: '11:00:00',
  slotMinutes: 30,
};

describe('meet', () => {
  it('timeSlots: 반개구간 [start, end)', () => {
    expect(timeSlots('09:00', '11:00', 30)).toEqual(['09:00', '09:30', '10:00', '10:30']);
    expect(timeSlots('09:00:00', '10:00:00', 60)).toEqual(['09:00']);
  });

  it('allSlotKeys: 날짜 × 시간', () => {
    const keys = allSlotKeys(POLL);
    expect(keys).toHaveLength(8);
    expect(keys[0]).toBe('2026-09-01T09:00');
    expect(keys[7]).toBe('2026-09-02T10:30');
  });

  it('heatmap + bestSlots: 겹침 많은 순, 동률은 이른 시각', () => {
    const map = heatmap([
      { name: '철수', slots: ['2026-09-01T09:00', '2026-09-01T09:30'] },
      { name: '영희', slots: ['2026-09-01T09:30', '2026-09-02T10:00'] },
      { name: '민수', slots: ['2026-09-01T09:30', '2026-09-02T10:00'] },
    ]);
    const best = bestSlots(map, 2);
    expect(best[0]).toEqual({ key: '2026-09-01T09:30', count: 3, names: ['철수', '영희', '민수'] });
    expect(best[1].key).toBe('2026-09-02T10:00');
  });

  it('slotLabel: 요일 포함 라벨', () => {
    expect(slotLabel('2026-09-01T15:00')).toBe('9/1 (화) 15:00');
  });
});

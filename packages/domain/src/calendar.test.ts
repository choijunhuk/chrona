import { describe, expect, it } from 'vitest';

import {
  addDaysOnly,
  addMonths,
  monthGrid,
  weekIndexOf,
  weekOf,
} from './calendar';
import { asDateOnly } from './time';

describe('monthGrid (월요일 시작)', () => {
  it('2026년 8월: 1일은 토요일 → 첫 주는 7/27(월)부터', () => {
    const grid = monthGrid(2026, 8);
    expect(grid).toHaveLength(6);
    expect(grid[0].map((c) => c.date)).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
    expect(grid[0][4].inMonth).toBe(false); // 7/31
    expect(grid[0][5].inMonth).toBe(true); // 8/1
  });

  it('항상 6주 × 7일', () => {
    for (const [y, m] of [
      [2026, 2], // 28일, 2/1 = 일요일 (최소 주 케이스)
      [2026, 8],
      [2028, 2], // 윤년
      [2026, 12],
    ] as const) {
      const grid = monthGrid(y, m);
      expect(grid).toHaveLength(6);
      grid.forEach((w) => expect(w).toHaveLength(7));
    }
  });

  it('월 경계가 이어진다 (마지막 셀 + 1일 = 다음 격자 어딘가)', () => {
    const aug = monthGrid(2026, 8);
    const lastCell = aug[5][6].date;
    expect(addDaysOnly(aug[0][0].date, 41)).toBe(lastCell);
  });
});

describe('weekOf', () => {
  it('수요일 → 그 주 월요일부터', () => {
    // 2026-08-26 = 수요일
    expect(weekOf(asDateOnly('2026-08-26'))).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
  });

  it('월요일 자신 / 일요일은 같은 주', () => {
    expect(weekOf(asDateOnly('2026-08-24'))[0]).toBe('2026-08-24');
    expect(weekOf(asDateOnly('2026-08-30'))[0]).toBe('2026-08-24');
  });
});

describe('weekIndexOf / addMonths', () => {
  it('격자 내 주 인덱스', () => {
    const grid = monthGrid(2026, 8);
    expect(weekIndexOf(grid, asDateOnly('2026-08-01'))).toBe(0);
    expect(weekIndexOf(grid, asDateOnly('2026-08-24'))).toBe(4);
    expect(weekIndexOf(grid, asDateOnly('2026-10-01'))).toBe(-1);
  });

  it('addMonths 연도 경계', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 8, -20)).toEqual({ year: 2024, month: 12 });
  });
});

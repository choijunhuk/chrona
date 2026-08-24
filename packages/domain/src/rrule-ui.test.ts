import { describe, expect, it } from 'vitest';

import { describeRepeat, fromRRuleString, toRRuleString } from './rrule-ui';

describe('rrule 직렬화 ↔ 역파싱 (검증 11)', () => {
  it('왕복 동일성', () => {
    const cases = [
      { freq: 'none', weekdays: [], count: null },
      { freq: 'daily', weekdays: [], count: null },
      { freq: 'weekly', weekdays: [2, 4], count: null },
      { freq: 'biweekly', weekdays: [1], count: 10 },
      { freq: 'monthly', weekdays: [], count: 6 },
    ] as const;
    for (const c of cases) {
      const rrule = toRRuleString({ ...c, weekdays: [...c.weekdays] });
      const back = fromRRuleString(rrule);
      expect(back).toEqual({ ...c, weekdays: [...c.weekdays] });
    }
  });

  it('지원 밖 규칙은 custom', () => {
    expect(fromRRuleString('FREQ=MONTHLY;BYSETPOS=2;BYDAY=TU')).toBe('custom');
    expect(fromRRuleString('FREQ=WEEKLY;INTERVAL=3')).toBe('custom');
  });

  it('미리보기 문구', () => {
    expect(describeRepeat({ freq: 'weekly', weekdays: [2, 4], count: null })).toBe('매주 화, 목');
    expect(describeRepeat({ freq: 'biweekly', weekdays: [1], count: 10 })).toBe('격주 월 · 10회');
    expect(describeRepeat({ freq: 'none', weekdays: [], count: null })).toBe('반복 안 함');
  });
});

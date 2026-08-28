import { describe, expect, it } from 'vitest';

import { parseQuickAdd } from './quick-add';

const TZ = 'Asia/Seoul';
// 2026-08-28 (금) 12:00 KST = 03:00 UTC
const NOW = new Date('2026-08-28T03:00:00Z');

describe('parseQuickAdd', () => {
  it('내일 오후 3시 팀플', () => {
    const r = parseQuickAdd('내일 오후 3시 팀플', NOW, TZ)!;
    expect(r.title).toBe('팀플');
    expect(r.allDay).toBe(false);
    expect(r.start!.toISOString()).toBe('2026-08-29T06:00:00.000Z'); // 15:00 KST
  });

  it('수식어 없는 1~7시는 오후 추정', () => {
    const r = parseQuickAdd('3시 회의', NOW, TZ)!;
    expect(r.start!.toISOString()).toBe('2026-08-28T06:00:00.000Z'); // 오늘 15:00 KST
  });

  it('지난 시각이면 내일로: 오전 9시 (지금 12시)', () => {
    const r = parseQuickAdd('오전 9시 스탠드업', NOW, TZ)!;
    expect(r.start!.toISOString()).toBe('2026-08-29T00:00:00.000Z'); // 내일 09:00 KST
  });

  it('다가오는 요일: 월요일 (오늘 금요일)', () => {
    const r = parseQuickAdd('월요일 10:30 발표', NOW, TZ)!;
    expect(r.start!.toISOString()).toBe('2026-08-31T01:30:00.000Z');
  });

  it('다음주 금요일 = 다음 월요일 주간의 금요일', () => {
    const r = parseQuickAdd('다음주 금요일 시험', NOW, TZ)!;
    expect(r.allDay).toBe(true);
    expect(r.startDate).toBe('2026-09-04');
  });

  it('N월 M일 — 지났으면 내년', () => {
    expect(parseQuickAdd('9월 15일 개강파티', NOW, TZ)!.startDate).toBe('2026-09-15');
    expect(parseQuickAdd('3월 2일 개강', NOW, TZ)!.startDate).toBe('2027-03-02');
  });

  it('날짜·시간 없으면 오늘 종일', () => {
    const r = parseQuickAdd('장보기', NOW, TZ)!;
    expect(r.allDay).toBe(true);
    expect(r.startDate).toBe('2026-08-28');
    expect(r.title).toBe('장보기');
  });

  it('반 = 30분, 저녁 = 오후', () => {
    const r = parseQuickAdd('저녁 7시 반 약속', NOW, TZ)!;
    expect(r.start!.toISOString()).toBe('2026-08-28T10:30:00.000Z'); // 19:30 KST
  });

  it('제목 없으면 null', () => {
    expect(parseQuickAdd('내일 3시', NOW, TZ)).toBeNull();
    expect(parseQuickAdd('   ', NOW, TZ)).toBeNull();
  });
});

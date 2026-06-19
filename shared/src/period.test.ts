import { describe, it, expect } from 'vitest';
import {
  parseISODate,
  toISODate,
  addDays,
  addMonths,
  diffDays,
  isInPeriod,
  weeklyPeriod,
  periodFor,
  periodLabel,
} from './period.js';

describe('parseISODate / toISODate', () => {
  it('round-trips ISO dates', () => {
    expect(toISODate(parseISODate('2026-05-31'))).toBe('2026-05-31');
  });
  it('throws on bad format or invalid date', () => {
    expect(() => parseISODate('2026-5-1')).toThrow();
    expect(() => parseISODate('2026-02-30')).toThrow();
    expect(() => parseISODate('not-a-date')).toThrow();
  });
});

describe('addDays / addMonths / diffDays', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-05-31', 1)).toBe('2026-06-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('adds months clamping the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-06-15', 2)).toBe('2026-08-15');
  });
  it('computes whole-day differences', () => {
    expect(diffDays('2026-06-01', '2026-06-08')).toBe(7);
    expect(diffDays('2026-06-08', '2026-06-01')).toBe(-7);
  });
});

describe('weeklyPeriod (Sun–Sat)', () => {
  it('buckets a Wednesday into its Sun–Sat week', () => {
    // 2026-06-03 is a Wednesday; that week is Sun 2026-05-31 .. Sat 2026-06-06.
    const p = weeklyPeriod('2026-06-03');
    expect(p.startDate).toBe('2026-05-31');
    expect(p.endDate).toBe('2026-06-06');
  });
  it('handles a Sunday as the start of its own week', () => {
    const p = weeklyPeriod('2026-05-31');
    expect(p.startDate).toBe('2026-05-31');
    expect(p.endDate).toBe('2026-06-06');
  });
  it('handles a Saturday as the end of its week', () => {
    const p = weeklyPeriod('2026-06-06');
    expect(p.startDate).toBe('2026-05-31');
    expect(p.endDate).toBe('2026-06-06');
  });
});

describe('isInPeriod', () => {
  const period = { startDate: '2026-05-31', endDate: '2026-06-06' };
  it('is inclusive of both boundaries', () => {
    expect(isInPeriod('2026-05-31', period)).toBe(true);
    expect(isInPeriod('2026-06-06', period)).toBe(true);
    expect(isInPeriod('2026-06-03', period)).toBe(true);
  });
  it('excludes dates outside', () => {
    expect(isInPeriod('2026-05-30', period)).toBe(false);
    expect(isInPeriod('2026-06-07', period)).toBe(false);
  });
});

describe('periodFor', () => {
  const anchor = '2026-05-31'; // a Sunday

  it('weekly aligns to anchor (matches Sun–Sat)', () => {
    expect(periodFor('2026-06-03', 'weekly', anchor)).toEqual({
      startDate: '2026-05-31',
      endDate: '2026-06-06',
    });
    // Next week
    expect(periodFor('2026-06-10', 'weekly', anchor)).toEqual({
      startDate: '2026-06-07',
      endDate: '2026-06-13',
    });
  });

  it('buckets dates before the anchor correctly', () => {
    expect(periodFor('2026-05-30', 'weekly', anchor)).toEqual({
      startDate: '2026-05-24',
      endDate: '2026-05-30',
    });
  });

  it('biweekly produces 14-day windows aligned to anchor', () => {
    expect(periodFor('2026-06-10', 'biweekly', anchor)).toEqual({
      startDate: '2026-05-31',
      endDate: '2026-06-13',
    });
    expect(periodFor('2026-06-14', 'biweekly', anchor)).toEqual({
      startDate: '2026-06-14',
      endDate: '2026-06-27',
    });
  });

  it('custom requires a positive integer length', () => {
    expect(periodFor('2026-06-02', 'custom', anchor, 10)).toEqual({
      startDate: '2026-05-31',
      endDate: '2026-06-09',
    });
    expect(() => periodFor('2026-06-02', 'custom', anchor)).toThrow();
    expect(() => periodFor('2026-06-02', 'custom', anchor, 0)).toThrow();
  });

  it('monthly with day-1 anchor gives calendar months', () => {
    expect(periodFor('2026-06-15', 'monthly', '2026-01-01')).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    });
  });

  it('monthly with mid-month anchor gives shifted windows', () => {
    // Anchor day 15: June window is 2026-06-15 .. 2026-07-14
    expect(periodFor('2026-06-20', 'monthly', '2026-01-15')).toEqual({
      startDate: '2026-06-15',
      endDate: '2026-07-14',
    });
    // A date before the 15th falls in the previous window
    expect(periodFor('2026-06-10', 'monthly', '2026-01-15')).toEqual({
      startDate: '2026-05-15',
      endDate: '2026-06-14',
    });
  });
});

describe('periodLabel', () => {
  it('formats a readable range', () => {
    expect(periodLabel({ startDate: '2026-05-31', endDate: '2026-06-06' })).toBe(
      'May 31 – Jun 6',
    );
  });
});

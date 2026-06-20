import { describe, it, expect } from 'vitest';
import { buildPeriods, defaultRange } from './history.js';

// Anchor on a Sunday so weekly periods are Sun–Sat.
const SUN_ANCHOR = '2026-01-04'; // Sunday

describe('buildPeriods (weekly)', () => {
  it('covers the range with contiguous, non-overlapping periods', () => {
    const periods = buildPeriods('2026-01-05', '2026-01-20', 'weekly', SUN_ANCHOR);
    // 2026-01-05 is in the Jan 4–10 week; range end 2026-01-20 is in Jan 18–24.
    expect(periods.map((p) => [p.startDate, p.endDate])).toEqual([
      ['2026-01-04', '2026-01-10'],
      ['2026-01-11', '2026-01-17'],
      ['2026-01-18', '2026-01-24'],
    ]);
    // No gaps: each period starts the day after the previous ends.
    for (let i = 1; i < periods.length; i += 1) {
      const prevEnd = new Date(periods[i - 1].endDate + 'T00:00:00Z').getTime();
      const start = new Date(periods[i].startDate + 'T00:00:00Z').getTime();
      expect(start - prevEnd).toBe(86400000);
    }
  });

  it('returns a single period when from and to are in the same period', () => {
    const periods = buildPeriods('2026-01-05', '2026-01-08', 'weekly', SUN_ANCHOR);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ startDate: '2026-01-04', endDate: '2026-01-10' });
    expect(periods[0].label).toBeTruthy();
  });

  it('returns empty when from is after to', () => {
    expect(buildPeriods('2026-02-01', '2026-01-01', 'weekly', SUN_ANCHOR)).toEqual([]);
  });
});

describe('buildPeriods (monthly)', () => {
  it('buckets calendar months when anchored on the 1st', () => {
    const periods = buildPeriods('2026-01-15', '2026-03-10', 'monthly', '2026-01-01');
    expect(periods.map((p) => [p.startDate, p.endDate])).toEqual([
      ['2026-01-01', '2026-01-31'],
      ['2026-02-01', '2026-02-28'],
      ['2026-03-01', '2026-03-31'],
    ]);
  });
});

describe('defaultRange', () => {
  it('spans the last N weekly periods ending with today’s period', () => {
    const { from, to } = defaultRange('2026-01-20', 8, 'weekly', SUN_ANCHOR);
    // Today's week is Jan 18–24; 8 periods back starts 7 weeks earlier.
    expect(to).toBe('2026-01-24');
    expect(from).toBe('2025-11-30'); // 7 weeks (49 days) before Jan 18
    const periods = buildPeriods(from, to, 'weekly', SUN_ANCHOR);
    expect(periods).toHaveLength(8);
  });
});

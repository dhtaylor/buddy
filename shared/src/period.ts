/**
 * Period / date module.
 *
 * Dates are handled as calendar dates in ISO "YYYY-MM-DD" form (no time, no
 * timezone) to avoid TZ drift. All math is done in UTC internally.
 *
 * A "period" is a budget window [startDate, endDate] (both inclusive ISO dates).
 * The default family period is a weekly Sunday–Saturday week, but periods can be
 * weekly, biweekly, monthly, or a fixed custom day-length.
 */

export type PeriodLength = 'weekly' | 'biweekly' | 'monthly' | 'custom';

export interface Period {
  /** Inclusive start date, "YYYY-MM-DD". */
  startDate: string;
  /** Inclusive end date, "YYYY-MM-DD". */
  endDate: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an ISO "YYYY-MM-DD" date into a UTC Date at midnight. Throws if invalid. */
export function parseISODate(iso: string): Date {
  if (!ISO_RE.test(iso)) {
    throw new Error(`Invalid ISO date (expected YYYY-MM-DD): ${iso}`);
  }
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  return date;
}

/** Format a UTC Date as an ISO "YYYY-MM-DD" string. */
export function toISODate(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Add a number of days (may be negative) to an ISO date, returning an ISO date. */
export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

/** Add a number of months to an ISO date, clamping the day to the month length. */
export function addMonths(iso: string, months: number): string {
  const date = parseISODate(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toISODate(date);
}

/** Whole-day difference endIso - startIso (endIso later => positive). */
export function diffDays(startIso: string, endIso: string): number {
  const a = parseISODate(startIso).getTime();
  const b = parseISODate(endIso).getTime();
  return Math.round((b - a) / 86400000);
}

/** True if iso is within [period.startDate, period.endDate] inclusive. */
export function isInPeriod(iso: string, period: Period): boolean {
  return iso >= period.startDate && iso <= period.endDate;
}

/**
 * The weekly Sunday–Saturday period containing `iso`.
 * Sunday is the first day of the family's week.
 */
export function weeklyPeriod(iso: string): Period {
  const date = parseISODate(iso);
  const dow = date.getUTCDay(); // 0 = Sunday
  const startDate = addDays(iso, -dow);
  const endDate = addDays(startDate, 6);
  return { startDate, endDate };
}

/**
 * Compute the period of the given length that contains `iso`, anchored at
 * `anchorDate` (the start of some known period — e.g. the household's first
 * budget period start). The anchor lets biweekly/custom periods line up
 * consistently across the calendar.
 *
 * - weekly:   7-day windows aligned to the anchor (use the Sunday anchor for Sun–Sat).
 * - biweekly: 14-day windows aligned to the anchor.
 * - custom:   `customDays`-length windows aligned to the anchor (customDays required).
 * - monthly:  calendar months; the anchor's day-of-month sets the boundary. If
 *             anchor day is 1, periods are calendar months (1st–end of month).
 */
export function periodFor(
  iso: string,
  length: PeriodLength,
  anchorDate: string,
  customDays?: number,
): Period {
  if (length === 'monthly') {
    return monthlyPeriod(iso, anchorDate);
  }

  let windowDays: number;
  if (length === 'weekly') windowDays = 7;
  else if (length === 'biweekly') windowDays = 14;
  else {
    if (!customDays || customDays < 1 || !Number.isInteger(customDays)) {
      throw new Error('periodFor: custom length requires a positive integer customDays');
    }
    windowDays = customDays;
  }

  const offset = diffDays(anchorDate, iso);
  // Floor-divide so dates before the anchor bucket correctly.
  const index = Math.floor(offset / windowDays);
  const startDate = addDays(anchorDate, index * windowDays);
  const endDate = addDays(startDate, windowDays - 1);
  return { startDate, endDate };
}

/**
 * Monthly period containing `iso`, with boundaries on the anchor's day-of-month.
 * E.g. anchor day 1 => calendar months; anchor day 15 => 15th-to-14th windows.
 */
function monthlyPeriod(iso: string, anchorDate: string): Period {
  const anchorDay = parseISODate(anchorDate).getUTCDate();
  const target = parseISODate(iso);
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();
  const d = target.getUTCDate();

  const clampedStartDay = (year: number, monthIdx: number): string => {
    const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
    const day = Math.min(anchorDay, lastDay);
    return toISODate(new Date(Date.UTC(year, monthIdx, day)));
  };

  let startDate: string;
  if (d >= Math.min(anchorDay, daysInMonth(y, m))) {
    startDate = clampedStartDay(y, m);
  } else {
    startDate = clampedStartDay(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1);
  }
  const endDate = addDays(addMonths(startDate, 1), -1);
  return { startDate, endDate };
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
}

/** A human label for a period, e.g. "May 31 – Jun 6". */
export function periodLabel(period: Period): string {
  const fmt = (iso: string) => {
    const date = parseISODate(iso);
    const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return `${month} ${date.getUTCDate()}`;
  };
  return `${fmt(period.startDate)} – ${fmt(period.endDate)}`;
}

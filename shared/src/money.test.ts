import { describe, it, expect } from 'vitest';
import { toCents, fromCents, formatCents, parseCents } from './money.js';

describe('toCents', () => {
  it('converts dollars to integer cents', () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0)).toBe(0);
    expect(toCents(1)).toBe(100);
  });

  it('rounds half-away-from-zero and avoids float drift', () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(2.675)).toBe(268);
  });

  it('handles negatives', () => {
    expect(toCents(-5)).toBe(-500);
    expect(toCents(-1.005)).toBe(-101);
  });

  it('throws on non-finite input', () => {
    expect(() => toCents(NaN)).toThrow();
    expect(() => toCents(Infinity)).toThrow();
  });
});

describe('fromCents', () => {
  it('converts integer cents back to dollars', () => {
    expect(fromCents(1234)).toBe(12.34);
    expect(fromCents(-500)).toBe(-5);
    expect(fromCents(0)).toBe(0);
  });

  it('throws on non-integer cents', () => {
    expect(() => fromCents(12.5)).toThrow();
  });
});

describe('formatCents', () => {
  it('formats with thousands separators and two decimals', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(100)).toBe('$1.00');
    expect(formatCents(100000000)).toBe('$1,000,000.00');
  });

  it('formats negatives with a leading minus', () => {
    expect(formatCents(-500)).toBe('-$5.00');
    expect(formatCents(-123456)).toBe('-$1,234.56');
  });

  it('throws on non-integer cents', () => {
    expect(() => formatCents(1.5)).toThrow();
  });
});

describe('parseCents', () => {
  it('parses plain and decorated dollar strings', () => {
    expect(parseCents('12.34')).toBe(1234);
    expect(parseCents('$1,234.56')).toBe(123456);
    expect(parseCents('5')).toBe(500);
    expect(parseCents('  $0.05 ')).toBe(5);
    expect(parseCents('.5')).toBe(50);
    expect(parseCents('1.5')).toBe(150);
  });

  it('parses negatives (sign and accounting parens)', () => {
    expect(parseCents('-5')).toBe(-500);
    expect(parseCents('(5.00)')).toBe(-500);
    expect(parseCents('($1,234.56)')).toBe(-123456);
  });

  it('returns null for invalid input', () => {
    expect(parseCents('abc')).toBeNull();
    expect(parseCents('')).toBeNull();
    expect(parseCents('1.234')).toBeNull();
    expect(parseCents('1.2.3')).toBeNull();
    expect(parseCents('$')).toBeNull();
    expect(parseCents('.')).toBeNull();
  });

  it('round-trips with formatCents', () => {
    const cents = 987654;
    expect(parseCents(formatCents(cents))).toBe(cents);
  });
});

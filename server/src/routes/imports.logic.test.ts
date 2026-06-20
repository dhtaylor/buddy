import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  directionForAmount,
  fingerprint,
  parseCsv,
  parseOfx,
  isMatch,
  pickMatch,
  type MatchCandidate,
  type NormalizedRow,
} from './imports.js';

describe('detectFormat', () => {
  it('detects by extension, case-insensitively', () => {
    expect(detectFormat('statement.csv')).toBe('csv');
    expect(detectFormat('STATEMENT.CSV')).toBe('csv');
    expect(detectFormat('export.ofx')).toBe('ofx');
    expect(detectFormat('export.qfx')).toBe('ofx');
    expect(detectFormat('photo.png')).toBeNull();
  });
});

describe('directionForAmount', () => {
  it('negative is money out (debit), positive is money in (credit)', () => {
    expect(directionForAmount(-1234)).toBe('debit');
    expect(directionForAmount(1234)).toBe('credit');
    expect(directionForAmount(0)).toBe('credit');
  });
});

describe('parseCsv', () => {
  it('parses the single signed Amount layout', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-06-10,Coffee Shop,-4.50',
      '2026-06-11,Paycheck,1500.00',
    ].join('\n');
    const rows = parseCsv(csv);
    expect(rows).toEqual<NormalizedRow[]>([
      { txnDate: '2026-06-10', description: 'Coffee Shop', amountCents: -450 },
      { txnDate: '2026-06-11', description: 'Paycheck', amountCents: 150000 },
    ]);
  });

  it('parses the two-column Debit/Credit layout', () => {
    const csv = [
      'Date,Description,Debit,Credit',
      '06/10/2026,Grocery Store,52.30,',
      '06/12/2026,Refund,,18.00',
    ].join('\n');
    const rows = parseCsv(csv);
    expect(rows).toEqual<NormalizedRow[]>([
      { txnDate: '2026-06-10', description: 'Grocery Store', amountCents: -5230 },
      { txnDate: '2026-06-12', description: 'Refund', amountCents: 1800 },
    ]);
  });

  it('is tolerant of header aliases, $ signs, commas and blank rows', () => {
    const csv = [
      'Transaction Date,Payee,Amount',
      '6/1/2026,Big Store,"-$1,234.56"',
      ',,',
    ].join('\n');
    const rows = parseCsv(csv);
    expect(rows).toEqual<NormalizedRow[]>([
      { txnDate: '2026-06-01', description: 'Big Store', amountCents: -123456 },
    ]);
  });
});

describe('parseOfx', () => {
  const sample = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260610120000
<TRNAMT>-4.50
<FITID>1001
<NAME>COFFEE SHOP
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260611
<TRNAMT>1500.00
<FITID>1002
<NAME>PAYCHECK
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

  it('parses STMTTRN entries with signed amounts and ISO dates', () => {
    const rows = parseOfx(sample);
    expect(rows).toEqual<NormalizedRow[]>([
      { txnDate: '2026-06-10', description: 'COFFEE SHOP', amountCents: -450 },
      { txnDate: '2026-06-11', description: 'PAYCHECK', amountCents: 150000 },
    ]);
  });
});

describe('fingerprint dedupe', () => {
  it('is stable for identical rows (case/whitespace-insensitive description)', () => {
    const a = fingerprint(1, '2026-06-10', -450, 'Coffee Shop');
    const b = fingerprint(1, '2026-06-10', -450, '  coffee   shop ');
    expect(a).toBe(b);
  });

  it('differs by account, date, amount, or description', () => {
    const base = fingerprint(1, '2026-06-10', -450, 'Coffee');
    expect(fingerprint(2, '2026-06-10', -450, 'Coffee')).not.toBe(base);
    expect(fingerprint(1, '2026-06-11', -450, 'Coffee')).not.toBe(base);
    expect(fingerprint(1, '2026-06-10', -451, 'Coffee')).not.toBe(base);
    expect(fingerprint(1, '2026-06-10', -450, 'Tea')).not.toBe(base);
  });
});

describe('auto-match predicate', () => {
  const row: NormalizedRow = { txnDate: '2026-06-10', description: 'Coffee', amountCents: -450 };

  it('matches on amount + direction + within ±4 days', () => {
    const c: MatchCandidate = {
      id: 1,
      entryDate: '2026-06-13',
      amountCents: 450,
      direction: 'debit',
    };
    expect(isMatch(row, c)).toBe(true);
  });

  it('rejects when outside the ±4 day window', () => {
    expect(
      isMatch(row, { id: 1, entryDate: '2026-06-15', amountCents: 450, direction: 'debit' }),
    ).toBe(false);
  });

  it('rejects on wrong direction or wrong amount', () => {
    expect(
      isMatch(row, { id: 1, entryDate: '2026-06-10', amountCents: 450, direction: 'credit' }),
    ).toBe(false);
    expect(
      isMatch(row, { id: 1, entryDate: '2026-06-10', amountCents: 999, direction: 'debit' }),
    ).toBe(false);
  });
});

describe('pickMatch', () => {
  const row: NormalizedRow = { txnDate: '2026-06-10', description: 'Coffee', amountCents: -450 };

  it('returns the id when exactly one candidate matches', () => {
    const candidates: MatchCandidate[] = [
      { id: 7, entryDate: '2026-06-09', amountCents: 450, direction: 'debit' },
      { id: 8, entryDate: '2026-06-09', amountCents: 999, direction: 'debit' },
    ];
    expect(pickMatch(row, candidates)).toBe(7);
  });

  it('returns null when ambiguous (more than one match)', () => {
    const candidates: MatchCandidate[] = [
      { id: 7, entryDate: '2026-06-09', amountCents: 450, direction: 'debit' },
      { id: 8, entryDate: '2026-06-11', amountCents: 450, direction: 'debit' },
    ];
    expect(pickMatch(row, candidates)).toBeNull();
  });

  it('returns null when no candidate matches', () => {
    expect(pickMatch(row, [])).toBeNull();
  });
});

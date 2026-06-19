/**
 * Money module — all money in Buddy is stored and computed as INTEGER CENTS.
 * Never use floats for money arithmetic. Convert to/from dollars only at the edges.
 */

/**
 * Convert a dollar amount (number) to integer cents.
 * Rounds half-away-from-zero to the nearest cent.
 * Example: toCents(12.34) -> 1234
 */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new Error(`toCents: not a finite number: ${dollars}`);
  }
  // Multiply then correct binary floating-point drift before rounding.
  // e.g. 1.005 * 100 === 100.49999999999999; toFixed(4) collapses the drift
  // to "100.5000" so half-away-from-zero rounding yields 101 cents.
  const scaled = dollars * 100;
  const corrected = Number(Math.abs(scaled).toFixed(4));
  return Math.sign(scaled) * Math.round(corrected);
}

/**
 * Convert integer cents to a dollar number.
 * Example: fromCents(1234) -> 12.34
 */
export function fromCents(cents: number): number {
  assertIntegerCents(cents);
  return cents / 100;
}

/**
 * Format integer cents as a US-style currency string with thousands separators.
 * Example: formatCents(123456) -> "$1,234.56"; formatCents(-500) -> "-$5.00"
 */
export function formatCents(cents: number): string {
  assertIntegerCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const dollarStr = dollars.toLocaleString('en-US');
  const centStr = remainder.toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${dollarStr}.${centStr}`;
}

/**
 * Parse a user-entered money string into integer cents.
 * Accepts optional leading "$", thousands separators, optional sign,
 * parentheses for negatives ("(5.00)" -> -500), and up to 2 decimal places.
 * Returns null if the input is not a valid money value.
 * Examples: parseCents("$1,234.56") -> 123456; parseCents("(5)") -> -500; parseCents("abc") -> null
 */
export function parseCents(input: string): number | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (s === '') return null;

  let negative = false;
  // Accounting-style negatives: (1,234.56)
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }

  // Strip a single leading currency symbol and any thousands separators.
  s = s.replace(/^\$/, '').replace(/,/g, '').trim();

  // Must be digits with an optional decimal part of at most 2 digits.
  if (!/^\d*(\.\d{0,2})?$/.test(s) || s === '' || s === '.') {
    return null;
  }

  const [whole, frac = ''] = s.split('.');
  const wholeCents = (whole === '' ? 0 : parseInt(whole, 10)) * 100;
  const fracCents = parseInt((frac + '00').slice(0, 2), 10);
  const cents = wholeCents + fracCents;
  return negative ? -cents : cents;
}

function assertIntegerCents(cents: number): void {
  if (!Number.isInteger(cents)) {
    throw new Error(`Expected integer cents, got: ${cents}`);
  }
}

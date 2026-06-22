import { categories } from './schema.js';

// Default category groups, seeded from the real paper budget photos. Applied to
// every newly created household (register + System Settings create) and the demo seed.
type Kind = 'income' | 'expense';
const CATEGORY_SEED: Array<{ group: string; kind: Kind; names: string[] }> = [
  { group: 'Income', kind: 'income', names: ['Paycheck', 'Transfer'] },
  { group: 'Church', kind: 'expense', names: ['Tithing', 'Fast Offering'] },
  { group: 'Groceries', kind: 'expense', names: ['Groceries'] },
  { group: 'House', kind: 'expense', names: ['House payment', 'Heloc'] },
  {
    group: 'Utilities',
    kind: 'expense',
    names: ['T-Mobile', 'Rocky Mtn Power', 'Enbridge Gas', 'Signature Pest', 'Wasatch Front Waste'],
  },
  {
    group: 'Healthcare',
    kind: 'expense',
    names: ['Am Gen Life', 'Redi Health', 'VA Payment', 'Select Health'],
  },
  { group: 'Cars', kind: 'expense', names: ['Fuel', 'Auto', 'Progressive'] },
  { group: 'Entertainment', kind: 'expense', names: ['Eating Out F', 'Eating Out D', 'Disney Plus'] },
  {
    group: 'Family',
    kind: 'expense',
    names: ['School Lunch/Fees', 'Christmas', 'Haircuts', 'Date', 'Savings'],
  },
  { group: 'Incidentals', kind: 'expense', names: ['Incidentals'] },
];

/** Build insertable category rows (with stable sortOrder) for a household. */
export function defaultCategoryRows(householdId: number): Array<typeof categories.$inferInsert> {
  const rows: Array<typeof categories.$inferInsert> = [];
  let sortOrder = 0;
  for (const grp of CATEGORY_SEED) {
    for (const name of grp.names) {
      rows.push({ householdId, groupName: grp.group, name, kind: grp.kind, sortOrder: sortOrder++ });
    }
  }
  return rows;
}

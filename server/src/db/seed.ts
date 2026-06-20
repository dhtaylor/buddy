/**
 * Seed a demo household with the real category groups from the paper budget.
 * Idempotent: if the demo household already exists, it does nothing.
 *
 * Run AFTER migrations: `npm run db:migrate` then `npm run seed`.
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { weeklyPeriod, toISODate } from '@buddy/shared';
import { db, sqlite } from './index.js';
import { households, users, householdMembers, accounts, categories } from './schema.js';

type Kind = 'income' | 'expense';

// Category groups seeded from the paper budget photos.
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

const DEMO_EMAIL = 'demo@buddy.local';
const DEMO_PASSWORD = 'password123';

function seed() {
  const existing = db.select().from(users).where(eq(users.email, DEMO_EMAIL)).get();
  if (existing) {
    console.log('Demo data already present — skipping seed.');
    return;
  }

  const todayIso = toISODate(new Date());
  const week = weeklyPeriod(todayIso);

  db.transaction((tx) => {
    const household = tx
      .insert(households)
      .values({
        name: 'Demo Household',
        periodLength: 'weekly',
        periodAnchorDate: week.startDate,
        periodCustomDays: null,
      })
      .returning()
      .get();

    const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    const user = tx
      .insert(users)
      .values({ email: DEMO_EMAIL, passwordHash, displayName: 'Demo User', isAdmin: true })
      .returning()
      .get();

    tx.insert(householdMembers)
      .values({ householdId: household.id, userId: user.id, role: 'owner' })
      .run();

    tx.insert(accounts)
      .values({
        householdId: household.id,
        name: 'Checking',
        type: 'checking',
        openingBalanceCents: 0,
      })
      .run();

    let sortOrder = 0;
    for (const grp of CATEGORY_SEED) {
      for (const name of grp.names) {
        tx.insert(categories)
          .values({
            householdId: household.id,
            groupName: grp.group,
            name,
            kind: grp.kind,
            sortOrder: sortOrder++,
          })
          .run();
      }
    }

    console.log(
      `Seeded household "${household.name}" (id=${household.id}), user ${DEMO_EMAIL} / ${DEMO_PASSWORD}, ${sortOrder} categories.`,
    );
  });
}

seed();
sqlite.close();

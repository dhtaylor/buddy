/**
 * Seed a demo household with the real category groups from the paper budget.
 * Idempotent: if the demo household already exists, it does nothing.
 *
 * Run AFTER migrations: `npm run db:migrate` then `npm run seed`.
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { weeklyPeriod, toISODate } from '@buddy/shared';
import { db, closeDb } from './index.js';
import { households, users, householdMembers, accounts, categories } from './schema.js';
import { defaultCategoryRows } from './default-categories.js';

const DEMO_EMAIL = 'demo@buddy.local';
const DEMO_PASSWORD = 'password123';

async function seed() {
  const existing = (await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1))[0];
  if (existing) {
    console.log('Demo data already present — skipping seed.');
    return;
  }

  const todayIso = toISODate(new Date());
  const week = weeklyPeriod(todayIso);

  await db.transaction(async (tx) => {
    const household = (
      await tx
        .insert(households)
        .values({
          name: 'Demo Household',
          periodLength: 'weekly',
          periodAnchorDate: week.startDate,
          periodCustomDays: null,
        })
        .returning()
    )[0];

    const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    const user = (
      await tx
        .insert(users)
        .values({ email: DEMO_EMAIL, passwordHash, displayName: 'Demo User', isAdmin: true })
        .returning()
    )[0];

    await tx
      .insert(householdMembers)
      .values({ householdId: household.id, userId: user.id, role: 'owner' });

    await tx.insert(accounts).values({
      householdId: household.id,
      name: 'Checking',
      type: 'checking',
      openingBalanceCents: 0,
    });

    const catRows = defaultCategoryRows(household.id);
    await tx.insert(categories).values(catRows);

    console.log(
      `Seeded household "${household.name}" (id=${household.id}), user ${DEMO_EMAIL} / ${DEMO_PASSWORD}, ${catRows.length} categories.`,
    );
  });
}

await seed();
await closeDb();

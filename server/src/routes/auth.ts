import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { weeklyPeriod, toISODate, type User } from '@buddy/shared';
import { db } from '../db/index.js';
import { users, households, householdMembers } from '../db/schema.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';

const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  householdName: z.string().min(1).optional(),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const addSpouseBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
});

function toUserDto(row: { id: number; email: string; displayName: string }): User {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

const authRoutes: FastifyPluginAsync = async (app) => {
  // Register a brand-new user AND create their household.
  app.post('/register', async (req, reply) => {
    const body = registerBody.parse(req.body);
    const existing = db.select().from(users).where(eq(users.email, body.email)).get();
    if (existing) throw conflict('Email already registered', 'email_taken');

    const passwordHash = bcrypt.hashSync(body.password, 10);
    const todayIso = toISODate(new Date());
    const week = weeklyPeriod(todayIso);

    const result = db.transaction((tx) => {
      const household = tx
        .insert(households)
        .values({
          name: body.householdName ?? `${body.displayName}'s Household`,
          periodLength: 'weekly',
          periodAnchorDate: week.startDate,
          periodCustomDays: null,
        })
        .returning()
        .get();
      const user = tx
        .insert(users)
        .values({ email: body.email, passwordHash, displayName: body.displayName })
        .returning()
        .get();
      tx.insert(householdMembers)
        .values({ householdId: household.id, userId: user.id, role: 'owner' })
        .run();
      return { user, householdId: household.id };
    });

    req.session.set('userId', result.user.id);
    req.session.set('householdId', result.householdId);
    return reply.code(201).send({ data: toUserDto(result.user) });
  });

  // Add a spouse/partner to the caller's existing household.
  app.post('/add-spouse', async (req, reply) => {
    const session = requireSession(req);
    const body = addSpouseBody.parse(req.body);
    const existing = db.select().from(users).where(eq(users.email, body.email)).get();
    if (existing) throw conflict('Email already registered', 'email_taken');

    const passwordHash = bcrypt.hashSync(body.password, 10);
    const user = db.transaction((tx) => {
      const created = tx
        .insert(users)
        .values({ email: body.email, passwordHash, displayName: body.displayName })
        .returning()
        .get();
      tx.insert(householdMembers)
        .values({ householdId: session.householdId, userId: created.id, role: 'member' })
        .run();
      return created;
    });
    return reply.code(201).send({ data: toUserDto(user) });
  });

  app.post('/login', async (req, reply) => {
    const body = loginBody.parse(req.body);
    const user = db.select().from(users).where(eq(users.email, body.email)).get();
    if (!user || !bcrypt.compareSync(body.password, user.passwordHash)) {
      throw unauthorized('Invalid email or password', 'invalid_credentials');
    }
    const membership = db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, user.id))
      .get();
    if (!membership) throw badRequest('User has no household', 'no_household');

    req.session.set('userId', user.id);
    req.session.set('householdId', membership.householdId);
    return reply.send({ data: toUserDto(user) });
  });

  app.post('/logout', async (req, reply) => {
    req.session.delete();
    return reply.send({ data: { ok: true } });
  });

  app.get('/me', async (req, reply) => {
    const session = requireSession(req);
    const user = db.select().from(users).where(eq(users.id, session.userId)).get();
    if (!user) {
      req.session.delete();
      throw unauthorized();
    }
    return reply.send({ data: toUserDto(user) });
  });
};

export default authRoutes;

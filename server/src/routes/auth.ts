import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { weeklyPeriod, toISODate, type User } from '@buddy/shared';
import { db } from '../db/index.js';
import { users, households, householdMembers } from '../db/schema.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { requireHouseholdAdmin, requireSession } from '../lib/auth.js';

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

function toUserDto(row: {
  id: number;
  email: string;
  displayName: string;
  isAdmin: boolean;
}): User {
  return { id: row.id, email: row.email, displayName: row.displayName, isAdmin: row.isAdmin };
}

const authRoutes: FastifyPluginAsync = async (app) => {
  // Whether open registration is available (only true on a fresh install with no
  // users yet). The login screen uses this to show/hide the register form.
  app.get('/registration-status', async (_req, reply) => {
    const anyUser = (await db.select().from(users).limit(1))[0];
    return reply.send({ data: { open: !anyUser } });
  });

  // Register the FIRST user (bootstrap admin) AND create their household.
  // Once any user exists, registration is closed — admins add users instead.
  app.post('/register', async (req, reply) => {
    const body = registerBody.parse(req.body);
    const anyUser = (await db.select().from(users).limit(1))[0];
    if (anyUser) {
      throw forbidden('Registration is closed. Ask an admin to add you.', 'registration_closed');
    }

    const passwordHash = bcrypt.hashSync(body.password, 10);
    const todayIso = toISODate(new Date());
    const week = weeklyPeriod(todayIso);
    // The very first user to register bootstraps as the global admin.
    const isFirstUser = !(await db.select().from(users).limit(1))[0];

    const result = await db.transaction(async (tx) => {
      const household = (
        await tx
          .insert(households)
          .values({
            name: body.householdName ?? `${body.displayName}'s Household`,
            periodLength: 'weekly',
            periodAnchorDate: week.startDate,
            periodCustomDays: null,
          })
          .returning()
      )[0];
      const user = (
        await tx
          .insert(users)
          .values({ email: body.email, passwordHash, displayName: body.displayName, isAdmin: isFirstUser })
          .returning()
      )[0];
      await tx
        .insert(householdMembers)
        .values({ householdId: household.id, userId: user.id, role: 'owner' });
      return { user, householdId: household.id };
    });

    req.session.set('userId', result.user.id);
    req.session.set('householdId', result.householdId);
    return reply.code(201).send({ data: toUserDto(result.user) });
  });

  // Add a member to the caller's active household (household admin only).
  app.post('/add-spouse', async (req, reply) => {
    const session = requireSession(req);
    await requireHouseholdAdmin(session.userId, session.householdId);
    const body = addSpouseBody.parse(req.body);
    const existing = (await db.select().from(users).where(eq(users.email, body.email)))[0];
    if (existing) throw conflict('Email already registered', 'email_taken');

    const passwordHash = bcrypt.hashSync(body.password, 10);
    const user = await db.transaction(async (tx) => {
      const created = (
        await tx
          .insert(users)
          .values({ email: body.email, passwordHash, displayName: body.displayName })
          .returning()
      )[0];
      await tx
        .insert(householdMembers)
        .values({ householdId: session.householdId, userId: created.id, role: 'member' });
      return created;
    });
    return reply.code(201).send({ data: toUserDto(user) });
  });

  app.post('/login', async (req, reply) => {
    const body = loginBody.parse(req.body);
    const user = (await db.select().from(users).where(eq(users.email, body.email)))[0];
    if (!user || !bcrypt.compareSync(body.password, user.passwordHash)) {
      throw unauthorized('Invalid email or password', 'invalid_credentials');
    }
    const membership = (
      await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.userId, user.id))
    )[0];
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
    const user = (await db.select().from(users).where(eq(users.id, session.userId)))[0];
    if (!user) {
      req.session.delete();
      throw unauthorized();
    }
    return reply.send({ data: toUserDto(user) });
  });
};

export default authRoutes;

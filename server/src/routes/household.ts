import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Household, HouseholdMember, User } from '@buddy/shared';
import { db } from '../db/index.js';
import { households, householdMembers, users } from '../db/schema.js';
import {
  authGuard,
  isMember,
  requireHouseholdAdmin,
  requireSession,
} from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

const updateBody = z
  .object({
    name: z.string().min(1).optional(),
    periodLength: z.enum(['weekly', 'biweekly', 'monthly', 'custom']).optional(),
    periodAnchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    periodCustomDays: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' });

function toDto(row: typeof households.$inferSelect): Household {
  return {
    id: row.id,
    name: row.name,
    periodLength: row.periodLength as Household['periodLength'],
    periodAnchorDate: row.periodAnchorDate,
    periodCustomDays: row.periodCustomDays,
  };
}

const switchBody = z.object({ householdId: z.number().int() });

const householdRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  // All households the caller belongs to (for the switcher).
  app.get('/mine', async (req, reply) => {
    const { userId } = requireSession(req);
    const rows = db
      .select({
        id: households.id,
        name: households.name,
        periodLength: households.periodLength,
        periodAnchorDate: households.periodAnchorDate,
        periodCustomDays: households.periodCustomDays,
        role: householdMembers.role,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(eq(householdMembers.userId, userId))
      .orderBy(asc(households.name))
      .all();
    const data = rows.map((r) => ({
      household: toDto(r),
      role: r.role as HouseholdMember['role'],
    }));
    return reply.send({ data });
  });

  // Switch the active household (must be a member).
  app.post('/switch', async (req, reply) => {
    const { userId } = requireSession(req);
    const { householdId } = switchBody.parse(req.body);
    if (!isMember(userId, householdId)) throw forbidden('Not a member of this household');
    req.session.set('householdId', householdId);
    const row = db.select().from(households).where(eq(households.id, householdId)).get();
    if (!row) throw notFound('Household not found');
    return reply.send({ data: toDto(row) });
  });

  app.get('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const row = db.select().from(households).where(eq(households.id, householdId)).get();
    if (!row) throw notFound('Household not found');
    return reply.send({ data: toDto(row) });
  });

  app.put('/', async (req, reply) => {
    const { userId, householdId } = requireSession(req);
    requireHouseholdAdmin(userId, householdId);
    const body = updateBody.parse(req.body);
    if (body.periodLength === 'custom' && !body.periodCustomDays) {
      // allow if already set; otherwise require it
      const current = db.select().from(households).where(eq(households.id, householdId)).get();
      if (!current?.periodCustomDays) {
        throw badRequest('custom period requires periodCustomDays', 'missing_custom_days');
      }
    }
    const row = db
      .update(households)
      .set(body)
      .where(eq(households.id, householdId))
      .returning()
      .get();
    if (!row) throw notFound('Household not found');
    return reply.send({ data: toDto(row) });
  });

  // Members of the caller's household (with user info).
  app.get('/members', async (req, reply) => {
    const { householdId } = requireSession(req);
    const rows = db
      .select({
        householdId: householdMembers.householdId,
        userId: householdMembers.userId,
        role: householdMembers.role,
        email: users.email,
        displayName: users.displayName,
      })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, householdId))
      .all();
    const data = rows.map((r) => ({
      member: {
        householdId: r.householdId,
        userId: r.userId,
        role: r.role as HouseholdMember['role'],
      },
      user: { id: r.userId, email: r.email, displayName: r.displayName } as User,
    }));
    return reply.send({ data });
  });

  // Remove a member from the caller's household (household admin only).
  app.delete('/members/:userId', async (req, reply) => {
    const { userId: callerId, householdId } = requireSession(req);
    requireHouseholdAdmin(callerId, householdId);
    const target = Number((req.params as { userId: string }).userId);
    if (target === callerId) throw badRequest('You cannot remove yourself');
    const row = db
      .delete(householdMembers)
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, target)),
      )
      .returning()
      .get();
    if (!row) throw notFound('Member not found');
    return reply.send({ data: { ok: true } });
  });
};

export default householdRoutes;

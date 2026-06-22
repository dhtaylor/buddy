import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { toISODate, weeklyPeriod, type User } from '@buddy/shared';
import { db } from '../db/index.js';
import {
  accounts,
  billOccurrences,
  bills,
  budgetLines,
  budgetPeriods,
  categories,
  households,
  householdMembers,
  importedTransactions,
  imports,
  ledgerEntries,
  users,
} from '../db/schema.js';
import { authGuard, requireSession, requireSystemAdmin } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { listBackups, runBackup } from '../lib/backup.js';
import { defaultCategoryRows } from '../db/default-categories.js';

async function adminCount(): Promise<number> {
  const r = (await db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.isAdmin, true)))[0];
  return Number(r?.c ?? 0);
}

const roleEnum = z.enum(['owner', 'member']);

const systemRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);
  // Every endpoint here is system-admin only.
  app.addHook('preHandler', async (req) => {
    await requireSystemAdmin(requireSession(req).userId);
  });

  // --- Overview ---
  app.get('/info', async (_req, reply) => {
    const hh = Number((await db.select({ c: sql<number>`count(*)` }).from(households))[0]?.c ?? 0);
    const us = Number((await db.select({ c: sql<number>`count(*)` }).from(users))[0]?.c ?? 0);
    return reply.send({ data: { households: hh, users: us, admins: await adminCount() } });
  });

  // --- Household management ---
  app.get('/households', async (_req, reply) => {
    const rows = await db
      .select({
        id: households.id,
        name: households.name,
        memberCount: sql<number>`count(${householdMembers.userId})`,
      })
      .from(households)
      .leftJoin(householdMembers, eq(householdMembers.householdId, households.id))
      .groupBy(households.id);
    return reply.send({ data: rows });
  });

  // Provision a new household. The creating system admin is added as its
  // household admin (owner) so it appears in their switcher immediately. This
  // does NOT switch the caller's active household.
  app.post('/households', async (req, reply) => {
    const { userId } = requireSession(req);
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const week = weeklyPeriod(toISODate(new Date()));
    const h = await db.transaction(async (tx) => {
      const created = (
        await tx
          .insert(households)
          .values({ name, periodLength: 'weekly', periodAnchorDate: week.startDate, periodCustomDays: null })
          .returning()
      )[0];
      await tx.insert(householdMembers).values({ householdId: created.id, userId, role: 'owner' });
      await tx.insert(categories).values(defaultCategoryRows(created.id));
      return created;
    });
    return reply.code(201).send({ data: { id: h.id, name: h.name } });
  });

  app.put('/households/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const row = (await db.update(households).set({ name }).where(eq(households.id, id)).returning())[0];
    if (!row) throw notFound('Household not found');
    return reply.send({ data: { id: row.id, name: row.name } });
  });

  app.delete('/households/:id', async (req, reply) => {
    const { householdId: active } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    if (id === active) throw badRequest('Switch to another household before deleting this one');
    const exists = (await db.select().from(households).where(eq(households.id, id)).limit(1))[0];
    if (!exists) throw notFound('Household not found');

    await db.transaction(async (tx) => {
      const billIds = (await tx.select({ id: bills.id }).from(bills).where(eq(bills.householdId, id))).map((b) => b.id);
      const importIds = (await tx.select({ id: imports.id }).from(imports).where(eq(imports.householdId, id))).map((i) => i.id);
      const periodIds = (await tx.select({ id: budgetPeriods.id }).from(budgetPeriods).where(eq(budgetPeriods.householdId, id))).map((p) => p.id);
      if (billIds.length) await tx.delete(billOccurrences).where(inArray(billOccurrences.billId, billIds));
      if (importIds.length) await tx.delete(importedTransactions).where(inArray(importedTransactions.importId, importIds));
      if (periodIds.length) await tx.delete(budgetLines).where(inArray(budgetLines.periodId, periodIds));
      await tx.delete(ledgerEntries).where(eq(ledgerEntries.householdId, id));
      await tx.delete(bills).where(eq(bills.householdId, id));
      await tx.delete(imports).where(eq(imports.householdId, id));
      await tx.delete(budgetPeriods).where(eq(budgetPeriods.householdId, id));
      await tx.delete(accounts).where(eq(accounts.householdId, id));
      await tx.delete(categories).where(eq(categories.householdId, id));
      await tx.delete(householdMembers).where(eq(householdMembers.householdId, id));
      await tx.delete(households).where(eq(households.id, id));
    });
    return reply.send({ data: { ok: true } });
  });

  // --- User & admin management ---
  app.get('/users', async (_req, reply) => {
    const us = await db.select().from(users);
    const memberships = await db
      .select({
        userId: householdMembers.userId,
        householdId: householdMembers.householdId,
        role: householdMembers.role,
        householdName: households.name,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId));
    const data = us.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      isAdmin: u.isAdmin,
      households: memberships
        .filter((m) => m.userId === u.id)
        .map((m) => ({ householdId: m.householdId, householdName: m.householdName, role: m.role })),
    }));
    return reply.send({ data });
  });

  const createUserBody = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    displayName: z.string().min(1),
    householdId: z.number().int(),
    role: roleEnum,
  });
  app.post('/users', async (req, reply) => {
    const body = createUserBody.parse(req.body);
    if ((await db.select().from(users).where(eq(users.email, body.email)).limit(1))[0]) {
      throw conflict('Email already registered', 'email_taken');
    }
    if (!(await db.select().from(households).where(eq(households.id, body.householdId)).limit(1))[0]) {
      throw notFound('Household not found');
    }
    const passwordHash = bcrypt.hashSync(body.password, 10);
    const created = await db.transaction(async (tx) => {
      const u = (
        await tx
          .insert(users)
          .values({ email: body.email, passwordHash, displayName: body.displayName, isAdmin: false })
          .returning()
      )[0];
      await tx.insert(householdMembers).values({ userId: u.id, householdId: body.householdId, role: body.role });
      return u;
    });
    const dto: User = { id: created.id, email: created.email, displayName: created.displayName, isAdmin: created.isAdmin };
    return reply.code(201).send({ data: dto });
  });

  app.put('/users/:id/admin', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { isAdmin } = z.object({ isAdmin: z.boolean() }).parse(req.body);
    const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!target) throw notFound('User not found');
    if (!isAdmin && target.isAdmin && (await adminCount()) <= 1) {
      throw badRequest('Cannot remove the last system admin');
    }
    const row = (await db.update(users).set({ isAdmin }).where(eq(users.id, id)).returning())[0];
    return reply.send({ data: { id: row.id, isAdmin: row.isAdmin } });
  });

  app.delete('/users/:id', async (req, reply) => {
    const { userId: callerId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    if (id === callerId) throw badRequest('You cannot delete your own account');
    const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!target) throw notFound('User not found');
    if (target.isAdmin && (await adminCount()) <= 1) throw badRequest('Cannot delete the last system admin');
    await db.transaction(async (tx) => {
      await tx.delete(householdMembers).where(eq(householdMembers.userId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
    return reply.send({ data: { ok: true } });
  });

  // --- Memberships (assign household admin / add to household / change role) ---
  const membershipBody = z.object({
    userId: z.number().int(),
    householdId: z.number().int(),
    role: roleEnum,
  });
  app.put('/memberships', async (req, reply) => {
    const { userId, householdId, role } = membershipBody.parse(req.body);
    if (!(await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]) throw notFound('User not found');
    if (!(await db.select().from(households).where(eq(households.id, householdId)).limit(1))[0]) {
      throw notFound('Household not found');
    }
    const existing = (
      await db
        .select()
        .from(householdMembers)
        .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId)))
        .limit(1)
    )[0];
    if (existing) {
      await db.update(householdMembers).set({ role }).where(eq(householdMembers.id, existing.id));
    } else {
      await db.insert(householdMembers).values({ userId, householdId, role });
    }
    return reply.send({ data: { userId, householdId, role } });
  });

  app.delete('/memberships', async (req, reply) => {
    const { userId, householdId } = z
      .object({ userId: z.number().int(), householdId: z.number().int() })
      .parse(req.body);
    const row = (
      await db
        .delete(householdMembers)
        .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId)))
        .returning()
    )[0];
    if (!row) throw notFound('Membership not found');
    return reply.send({ data: { ok: true } });
  });

  // --- Backups ---
  app.get('/backups', async (_req, reply) => reply.send({ data: listBackups() }));
  app.post('/backup', async (_req, reply) => {
    const file = await runBackup();
    return reply.send({ data: { file } });
  });
};

export default systemRoutes;

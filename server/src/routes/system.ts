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

function adminCount(): number {
  const r = db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.isAdmin, true)).get();
  return r?.c ?? 0;
}

const roleEnum = z.enum(['owner', 'member']);

const systemRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);
  // Every endpoint here is system-admin only.
  app.addHook('preHandler', async (req) => {
    requireSystemAdmin(requireSession(req).userId);
  });

  // --- Overview ---
  app.get('/info', async (_req, reply) => {
    const hh = db.select({ c: sql<number>`count(*)` }).from(households).get()?.c ?? 0;
    const us = db.select({ c: sql<number>`count(*)` }).from(users).get()?.c ?? 0;
    return reply.send({ data: { households: hh, users: us, admins: adminCount() } });
  });

  // --- Household management ---
  app.get('/households', async (_req, reply) => {
    const rows = db
      .select({
        id: households.id,
        name: households.name,
        memberCount: sql<number>`count(${householdMembers.userId})`,
      })
      .from(households)
      .leftJoin(householdMembers, eq(householdMembers.householdId, households.id))
      .groupBy(households.id)
      .all();
    return reply.send({ data: rows });
  });

  // Provision a new household. The creating system admin is added as its
  // household admin (owner) so it appears in their switcher immediately. This
  // does NOT switch the caller's active household.
  app.post('/households', async (req, reply) => {
    const { userId } = requireSession(req);
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const week = weeklyPeriod(toISODate(new Date()));
    const h = db.transaction((tx) => {
      const created = tx
        .insert(households)
        .values({ name, periodLength: 'weekly', periodAnchorDate: week.startDate, periodCustomDays: null })
        .returning()
        .get();
      tx.insert(householdMembers).values({ householdId: created.id, userId, role: 'owner' }).run();
      return created;
    });
    return reply.code(201).send({ data: { id: h.id, name: h.name } });
  });

  app.put('/households/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const row = db.update(households).set({ name }).where(eq(households.id, id)).returning().get();
    if (!row) throw notFound('Household not found');
    return reply.send({ data: { id: row.id, name: row.name } });
  });

  app.delete('/households/:id', async (req, reply) => {
    const { householdId: active } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    if (id === active) throw badRequest('Switch to another household before deleting this one');
    const exists = db.select().from(households).where(eq(households.id, id)).get();
    if (!exists) throw notFound('Household not found');

    db.transaction(() => {
      const billIds = db.select({ id: bills.id }).from(bills).where(eq(bills.householdId, id)).all().map((b) => b.id);
      const importIds = db.select({ id: imports.id }).from(imports).where(eq(imports.householdId, id)).all().map((i) => i.id);
      const periodIds = db.select({ id: budgetPeriods.id }).from(budgetPeriods).where(eq(budgetPeriods.householdId, id)).all().map((p) => p.id);
      if (billIds.length) db.delete(billOccurrences).where(inArray(billOccurrences.billId, billIds)).run();
      if (importIds.length) db.delete(importedTransactions).where(inArray(importedTransactions.importId, importIds)).run();
      if (periodIds.length) db.delete(budgetLines).where(inArray(budgetLines.periodId, periodIds)).run();
      db.delete(ledgerEntries).where(eq(ledgerEntries.householdId, id)).run();
      db.delete(bills).where(eq(bills.householdId, id)).run();
      db.delete(imports).where(eq(imports.householdId, id)).run();
      db.delete(budgetPeriods).where(eq(budgetPeriods.householdId, id)).run();
      db.delete(accounts).where(eq(accounts.householdId, id)).run();
      db.delete(categories).where(eq(categories.householdId, id)).run();
      db.delete(householdMembers).where(eq(householdMembers.householdId, id)).run();
      db.delete(households).where(eq(households.id, id)).run();
    });
    return reply.send({ data: { ok: true } });
  });

  // --- User & admin management ---
  app.get('/users', async (_req, reply) => {
    const us = db.select().from(users).all();
    const memberships = db
      .select({
        userId: householdMembers.userId,
        householdId: householdMembers.householdId,
        role: householdMembers.role,
        householdName: households.name,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .all();
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
    if (db.select().from(users).where(eq(users.email, body.email)).get()) {
      throw conflict('Email already registered', 'email_taken');
    }
    if (!db.select().from(households).where(eq(households.id, body.householdId)).get()) {
      throw notFound('Household not found');
    }
    const passwordHash = bcrypt.hashSync(body.password, 10);
    const created = db.transaction((tx) => {
      const u = tx
        .insert(users)
        .values({ email: body.email, passwordHash, displayName: body.displayName, isAdmin: false })
        .returning()
        .get();
      tx.insert(householdMembers).values({ userId: u.id, householdId: body.householdId, role: body.role }).run();
      return u;
    });
    const dto: User = { id: created.id, email: created.email, displayName: created.displayName, isAdmin: created.isAdmin };
    return reply.code(201).send({ data: dto });
  });

  app.put('/users/:id/admin', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { isAdmin } = z.object({ isAdmin: z.boolean() }).parse(req.body);
    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) throw notFound('User not found');
    if (!isAdmin && target.isAdmin && adminCount() <= 1) {
      throw badRequest('Cannot remove the last system admin');
    }
    const row = db.update(users).set({ isAdmin }).where(eq(users.id, id)).returning().get();
    return reply.send({ data: { id: row.id, isAdmin: row.isAdmin } });
  });

  app.delete('/users/:id', async (req, reply) => {
    const { userId: callerId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    if (id === callerId) throw badRequest('You cannot delete your own account');
    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) throw notFound('User not found');
    if (target.isAdmin && adminCount() <= 1) throw badRequest('Cannot delete the last system admin');
    db.transaction(() => {
      db.delete(householdMembers).where(eq(householdMembers.userId, id)).run();
      db.delete(users).where(eq(users.id, id)).run();
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
    if (!db.select().from(users).where(eq(users.id, userId)).get()) throw notFound('User not found');
    if (!db.select().from(households).where(eq(households.id, householdId)).get()) {
      throw notFound('Household not found');
    }
    const existing = db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId)))
      .get();
    if (existing) {
      db.update(householdMembers).set({ role }).where(eq(householdMembers.id, existing.id)).run();
    } else {
      db.insert(householdMembers).values({ userId, householdId, role }).run();
    }
    return reply.send({ data: { userId, householdId, role } });
  });

  app.delete('/memberships', async (req, reply) => {
    const { userId, householdId } = z
      .object({ userId: z.number().int(), householdId: z.number().int() })
      .parse(req.body);
    const row = db
      .delete(householdMembers)
      .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId)))
      .returning()
      .get();
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

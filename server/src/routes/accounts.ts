import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Account } from '@buddy/shared';
import { db } from '../db/index.js';
import { accounts } from '../db/schema.js';
import { authGuard, requireSession } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';

const accountBody = z.object({
  name: z.string().min(1),
  type: z.enum(['checking', 'savings', 'cash']),
  openingBalanceCents: z.number().int(),
});

function toDto(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    type: row.type as Account['type'],
    openingBalanceCents: row.openingBalanceCents,
  };
}

const accountsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  app.get('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const rows = db.select().from(accounts).where(eq(accounts.householdId, householdId)).all();
    return reply.send({ data: rows.map(toDto) });
  });

  app.post('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const body = accountBody.parse(req.body);
    const row = db
      .insert(accounts)
      .values({ householdId, ...body })
      .returning()
      .get();
    return reply.code(201).send({ data: toDto(row) });
  });

  app.put('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const body = accountBody.parse(req.body);
    const row = db
      .update(accounts)
      .set(body)
      .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)))
      .returning()
      .get();
    if (!row) throw notFound('Account not found');
    return reply.send({ data: toDto(row) });
  });

  app.delete('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const row = db
      .delete(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)))
      .returning()
      .get();
    if (!row) throw notFound('Account not found');
    return reply.send({ data: { ok: true } });
  });
};

export default accountsRoutes;

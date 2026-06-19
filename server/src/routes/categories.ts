import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Category } from '@buddy/shared';
import { db } from '../db/index.js';
import { categories } from '../db/schema.js';
import { authGuard, requireSession } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';

const categoryBody = z.object({
  groupName: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['income', 'expense']),
  sortOrder: z.number().int().optional(),
});

function toDto(row: typeof categories.$inferSelect): Category {
  return {
    id: row.id,
    householdId: row.householdId,
    groupName: row.groupName,
    name: row.name,
    kind: row.kind as Category['kind'],
    sortOrder: row.sortOrder,
  };
}

const categoriesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  app.get('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const rows = db
      .select()
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .all();
    return reply.send({ data: rows.map(toDto) });
  });

  app.post('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const body = categoryBody.parse(req.body);
    const row = db
      .insert(categories)
      .values({ householdId, sortOrder: 0, ...body })
      .returning()
      .get();
    return reply.code(201).send({ data: toDto(row) });
  });

  app.put('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const body = categoryBody.parse(req.body);
    const row = db
      .update(categories)
      .set(body)
      .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
      .returning()
      .get();
    if (!row) throw notFound('Category not found');
    return reply.send({ data: toDto(row) });
  });

  app.delete('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const row = db
      .delete(categories)
      .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
      .returning()
      .get();
    if (!row) throw notFound('Category not found');
    return reply.send({ data: { ok: true } });
  });
};

export default categoriesRoutes;

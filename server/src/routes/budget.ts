import type { FastifyPluginAsync } from 'fastify';
import { authGuard } from '../lib/auth.js';

/**
 * STUB — owned by the budget feature agent.
 * Registered under /api/budget. Add real routes here; the plugin is already
 * wired into the server entry, so do NOT edit src/index.ts.
 */
const budgetRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  app.all('/', async (_req, reply) =>
    reply.code(501).send({
      error: { code: 'not_implemented', message: 'budget not implemented yet' },
    }),
  );
};

export default budgetRoutes;

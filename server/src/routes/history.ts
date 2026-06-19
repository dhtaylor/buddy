import type { FastifyPluginAsync } from 'fastify';
import { authGuard } from '../lib/auth.js';

/**
 * STUB — owned by the history feature agent.
 * Registered under /api/history. Add real routes here; the plugin is already
 * wired into the server entry, so do NOT edit src/index.ts.
 */
const historyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  app.all('/', async (_req, reply) =>
    reply.code(501).send({
      error: { code: 'not_implemented', message: 'history not implemented yet' },
    }),
  );
};

export default historyRoutes;

import type { FastifyPluginAsync } from 'fastify';
import { authGuard } from '../lib/auth.js';

/**
 * STUB — owned by the ledger feature agent.
 * Registered under /api/ledger. Add real routes here; the plugin is already
 * wired into the server entry, so do NOT edit src/index.ts.
 */
const ledgerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  app.all('/', async (_req, reply) =>
    reply.code(501).send({
      error: { code: 'not_implemented', message: 'ledger not implemented yet' },
    }),
  );
};

export default ledgerRoutes;

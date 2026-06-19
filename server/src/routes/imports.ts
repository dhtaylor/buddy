import type { FastifyPluginAsync } from 'fastify';
import { authGuard } from '../lib/auth.js';

/**
 * STUB — owned by the imports feature agent.
 * Registered under /api/imports. Add real routes here; the plugin is already
 * wired into the server entry, so do NOT edit src/index.ts.
 */
const importsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  app.all('/', async (_req, reply) =>
    reply.code(501).send({
      error: { code: 'not_implemented', message: 'imports not implemented yet' },
    }),
  );
};

export default importsRoutes;

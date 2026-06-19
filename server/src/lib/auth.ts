import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { householdMembers } from '../db/schema.js';
import { unauthorized } from './errors.js';

/** Shape stored in the encrypted session cookie. */
export interface SessionData {
  userId: number;
  householdId: number;
}

declare module '@fastify/secure-session' {
  interface SessionData {
    userId: number;
    householdId: number;
  }
}

/**
 * Resolve the authenticated session or throw 401.
 * Use inside route handlers (or via the `authGuard` preHandler) to obtain the
 * caller's userId + householdId. Every domain query MUST scope by householdId.
 */
export function requireSession(req: FastifyRequest): SessionData {
  const userId = req.session.get('userId');
  const householdId = req.session.get('householdId');
  if (typeof userId !== 'number' || typeof householdId !== 'number') {
    throw unauthorized();
  }
  return { userId, householdId };
}

/** Fastify preHandler that enforces an authenticated session. */
export async function authGuard(req: FastifyRequest): Promise<void> {
  requireSession(req);
}

/** The household the user currently belongs to (first membership). */
export function householdIdForUser(userId: number): number | null {
  const row = db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .get();
  return row?.householdId ?? null;
}

import type { FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { householdMembers, users } from '../db/schema.js';
import { forbidden, unauthorized } from './errors.js';

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

/** True if the user is a global admin (may create households). */
export function isAdminUser(userId: number): boolean {
  const row = db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).get();
  return !!row?.isAdmin;
}

/** The user's role in a household, or null if not a member. */
export function roleInHousehold(userId: number, householdId: number): 'owner' | 'member' | null {
  const row = db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId)))
    .get();
  return (row?.role as 'owner' | 'member' | undefined) ?? null;
}

/** True if the user is a member of the household. */
export function isMember(userId: number, householdId: number): boolean {
  return roleInHousehold(userId, householdId) !== null;
}

/** True if the user is the household admin (owner) of the household. */
export function isHouseholdAdmin(userId: number, householdId: number): boolean {
  return roleInHousehold(userId, householdId) === 'owner';
}

/** Throw 403 unless the user is the household admin (owner) of the household. */
export function requireHouseholdAdmin(userId: number, householdId: number): void {
  if (!isHouseholdAdmin(userId, householdId)) {
    throw forbidden('Only the household admin can change household settings');
  }
}

/** Throw 403 unless the user is a global (system) admin. */
export function requireSystemAdmin(userId: number): void {
  if (!isAdminUser(userId)) throw forbidden('System admin only');
}

/**
 * Fastify preHandler that enforces an authenticated session AND that the caller
 * is actually a member of the session's household. The membership check is the
 * tenant-isolation backstop: even a stale/forged session can't reach a household
 * the user no longer belongs to.
 */
export async function authGuard(req: FastifyRequest): Promise<void> {
  const { userId, householdId } = requireSession(req);
  if (!isMember(userId, householdId)) {
    throw forbidden('Not a member of this household');
  }
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

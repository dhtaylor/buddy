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
export async function isAdminUser(userId: number): Promise<boolean> {
  const row = (
    await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  return !!row?.isAdmin;
}

/** The user's role in a household, or null if not a member. */
export async function roleInHousehold(
  userId: number,
  householdId: number,
): Promise<'owner' | 'member' | null> {
  const row = (
    await db
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId)))
      .limit(1)
  )[0];
  return (row?.role as 'owner' | 'member' | undefined) ?? null;
}

/** True if the user is a member of the household. */
export async function isMember(userId: number, householdId: number): Promise<boolean> {
  return (await roleInHousehold(userId, householdId)) !== null;
}

/** True if the user is the household admin (owner) of the household. */
export async function isHouseholdAdmin(userId: number, householdId: number): Promise<boolean> {
  return (await roleInHousehold(userId, householdId)) === 'owner';
}

/** Throw 403 unless the user is the household admin (owner) of the household. */
export async function requireHouseholdAdmin(userId: number, householdId: number): Promise<void> {
  if (!(await isHouseholdAdmin(userId, householdId))) {
    throw forbidden('Only the household admin can change household settings');
  }
}

/** Throw 403 unless the user is a global (system) admin. */
export async function requireSystemAdmin(userId: number): Promise<void> {
  if (!(await isAdminUser(userId))) throw forbidden('System admin only');
}

/**
 * Fastify preHandler that enforces an authenticated session AND that the caller
 * is actually a member of the session's household. The membership check is the
 * tenant-isolation backstop: even a stale/forged session can't reach a household
 * the user no longer belongs to.
 */
export async function authGuard(req: FastifyRequest): Promise<void> {
  const { userId, householdId } = requireSession(req);
  if (!(await isMember(userId, householdId))) {
    throw forbidden('Not a member of this household');
  }
}

/** The household the user currently belongs to (first membership). */
export async function householdIdForUser(userId: number): Promise<number | null> {
  const row = (
    await db.select().from(householdMembers).where(eq(householdMembers.userId, userId)).limit(1)
  )[0];
  return row?.householdId ?? null;
}

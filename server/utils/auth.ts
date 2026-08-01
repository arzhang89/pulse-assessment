import type { H3Event } from 'h3'
import { and, eq, gt } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { sessions, users } from '../../db/schema'
import { getEnv } from '../../shared/env'
import { SESSION_COOKIE_NAME, SESSION_TTL_MS, hashSessionToken } from '../../shared/session-token'
import { AppError } from './errors'

export type AuthenticatedUser = {
  id: string
  email: string
  statusPageSlug: string
  createdAt: Date
}

export type AuthContext = {
  user: AuthenticatedUser
  sessionId: string
}

export function setSessionCookie(event: H3Event, rawToken: string): void {
  setCookie(event, SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: getEnv().NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: 'lax',
    secure: getEnv().NODE_ENV === 'production',
  })
}

export function toPublicUser(user: {
  id: string
  email: string
  statusPageSlug: string
  createdAt: Date
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    statusPageSlug: user.statusPageSlug,
    createdAt: user.createdAt,
  }
}

/**
 * Resolves the current session from the HttpOnly cookie.
 * Expired sessions are rejected; the stale cookie is cleared when practical.
 */
export async function requireUser(event: H3Event): Promise<AuthContext> {
  const rawToken = getCookie(event, SESSION_COOKIE_NAME)
  if (!rawToken) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required')
  }

  const tokenHash = hashSessionToken(rawToken)
  const db = getDb()
  const now = new Date()

  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      statusPageSlug: users.statusPageSlug,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1)

  if (!row) {
    clearSessionCookie(event)
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required')
  }

  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      statusPageSlug: row.statusPageSlug,
      createdAt: row.createdAt,
    },
  }
}

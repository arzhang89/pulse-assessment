import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { sessions, users } from '../../db/schema'
import { hashPassword, verifyPasswordForLogin } from '../../shared/password'
import {
  generateSessionToken,
  hashSessionToken,
  sessionExpiryDate,
} from '../../shared/session-token'
import { normalizeEmail } from '../../shared/validation/auth'
import { AppError } from '../utils/errors'
import { toPublicUser, type AuthenticatedUser } from '../utils/auth'

const SLUG_MAX_ATTEMPTS = 5

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code =
    'code' in error && typeof error.code === 'string'
      ? error.code
      : 'cause' in error &&
          error.cause &&
          typeof error.cause === 'object' &&
          'code' in error.cause &&
          typeof error.cause.code === 'string'
        ? error.cause.code
        : undefined
  return code === '23505'
}

function uniqueConstraintName(error: unknown): string | undefined {
  const source =
    error &&
    typeof error === 'object' &&
    'cause' in error &&
    error.cause &&
    typeof error.cause === 'object'
      ? error.cause
      : error

  if (source && typeof source === 'object' && 'constraint' in source) {
    return typeof source.constraint === 'string' ? source.constraint : undefined
  }
  return undefined
}

function generateStatusPageSlug(): string {
  return randomBytes(16).toString('base64url')
}

export async function signupUser(input: {
  email: string
  password: string
}): Promise<{ user: AuthenticatedUser; rawSessionToken: string }> {
  const email = normalizeEmail(input.email)
  // Hash before opening the DB transaction (CPU-bound work stays outside the TX).
  const passwordHash = await hashPassword(input.password)
  const rawSessionToken = generateSessionToken()
  const tokenHash = hashSessionToken(rawSessionToken)
  const expiresAt = sessionExpiryDate()

  const db = getDb()

  for (let attempt = 0; attempt < SLUG_MAX_ATTEMPTS; attempt += 1) {
    const statusPageSlug = generateStatusPageSlug()

    try {
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            email,
            passwordHash,
            statusPageSlug,
          })
          .returning({
            id: users.id,
            email: users.email,
            statusPageSlug: users.statusPageSlug,
            createdAt: users.createdAt,
          })

        if (!user) {
          throw new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')
        }

        await tx.insert(sessions).values({
          userId: user.id,
          tokenHash,
          expiresAt,
        })

        return user
      })

      return {
        user: toPublicUser(result),
        rawSessionToken,
      }
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }

      const constraint = uniqueConstraintName(error)
      if (constraint?.includes('email')) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
      }

      // Status-page slug collision — retry with a new slug.
      if (constraint?.includes('status_page_slug') && attempt < SLUG_MAX_ATTEMPTS - 1) {
        continue
      }

      if (constraint?.includes('status_page_slug')) {
        throw new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')
      }

      // Fallback: treat unknown unique violations on signup as email conflicts.
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
    }
  }

  throw new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')
}

export async function loginUser(input: {
  email: string
  password: string
}): Promise<{ user: AuthenticatedUser; rawSessionToken: string }> {
  const email = normalizeEmail(input.email)
  const db = getDb()

  const [existing] = await db
    .select({
      id: users.id,
      email: users.email,
      statusPageSlug: users.statusPageSlug,
      createdAt: users.createdAt,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  const passwordOk = await verifyPasswordForLogin(input.password, existing?.passwordHash ?? null)

  if (!existing || !passwordOk) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
  }

  const rawSessionToken = generateSessionToken()
  const tokenHash = hashSessionToken(rawSessionToken)
  const expiresAt = sessionExpiryDate()

  await db.insert(sessions).values({
    userId: existing.id,
    tokenHash,
    expiresAt,
  })

  return {
    user: toPublicUser(existing),
    rawSessionToken,
  }
}

export async function logoutSession(rawToken: string | undefined): Promise<void> {
  if (!rawToken) {
    return
  }

  const tokenHash = hashSessionToken(rawToken)
  const db = getDb()
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
}

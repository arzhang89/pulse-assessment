import { z } from 'zod'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password.js'

export const authCredentialsSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(320),
  // Passwords are intentionally not trimmed.
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`),
})

export type AuthCredentials = z.infer<typeof authCredentialsSchema>

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

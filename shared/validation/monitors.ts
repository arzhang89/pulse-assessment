import { z } from 'zod'
import { normalizeMonitorUrl } from '../monitor-url.js'

export const MONITOR_INTERVAL_SECONDS = [60, 300, 900, 1800, 3600] as const

const monitorIntervalSchema = z.union([
  z.literal(60),
  z.literal(300),
  z.literal(900),
  z.literal(1800),
  z.literal(3600),
])

const monitorUrlSchema = z
  .string()
  .min(1, 'URL is required')
  .max(2048, 'URL is too long')
  .superRefine((value, ctx) => {
    const parsed = normalizeMonitorUrl(value)
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.message })
    }
  })
  .transform((value) => {
    const parsed = normalizeMonitorUrl(value)
    if (!parsed.ok) {
      throw new Error(parsed.message)
    }
    return parsed.href
  })

export const createMonitorSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    url: monitorUrlSchema,
    intervalSeconds: monitorIntervalSchema,
    enabled: z.boolean().optional().default(true),
    isPublic: z.boolean().optional().default(false),
  })
  .strict()

export const updateMonitorSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200).optional(),
    url: monitorUrlSchema.optional(),
    intervalSeconds: monitorIntervalSchema.optional(),
    enabled: z.boolean().optional(),
    isPublic: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })

export const monitorIdSchema = z.string().uuid('Monitor id must be a valid UUID')

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>

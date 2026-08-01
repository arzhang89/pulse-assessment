import { z } from 'zod'
import { normalizeMonitorUrl } from '../monitor-url.js'

const webhookUrlSchema = z
  .string()
  .min(1, 'Webhook URL is required')
  .max(2048, 'Webhook URL is too long')
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

export const putNotificationSettingsSchema = z
  .object({
    webhookUrl: z.union([webhookUrlSchema, z.null()]),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.enabled && value.webhookUrl === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['webhookUrl'],
        message: 'Webhook URL is required when notifications are enabled',
      })
    }
  })

export type PutNotificationSettingsInput = z.infer<typeof putNotificationSettingsSchema>

export type PublicNotificationSettings = {
  webhookUrl: string | null
  enabled: boolean
}

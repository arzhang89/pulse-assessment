import { eq } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { notificationSettings } from '../../db/schema'
import type {
  PublicNotificationSettings,
  PutNotificationSettingsInput,
} from '../../shared/validation/notification-settings'

/**
 * Settings changes affect future outbox creation only.
 * Existing notification_outbox rows keep snapshotted destination_url.
 */
export async function getNotificationSettingsForUser(
  userId: string,
): Promise<PublicNotificationSettings> {
  const db = getDb()
  const [row] = await db
    .select({
      webhookUrl: notificationSettings.webhookUrl,
      enabled: notificationSettings.enabled,
    })
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId))
    .limit(1)

  if (!row) {
    return { webhookUrl: null, enabled: false }
  }

  return {
    webhookUrl: row.webhookUrl,
    enabled: row.enabled,
  }
}

export async function putNotificationSettingsForUser(
  userId: string,
  input: PutNotificationSettingsInput,
): Promise<PublicNotificationSettings> {
  const db = getDb()

  // enabled=false + webhookUrl=null → delete the row (clear settings).
  if (!input.enabled && input.webhookUrl === null) {
    await db.delete(notificationSettings).where(eq(notificationSettings.userId, userId))
    return { webhookUrl: null, enabled: false }
  }

  const now = new Date()
  const webhookUrl = input.webhookUrl!

  const [row] = await db
    .insert(notificationSettings)
    .values({
      userId,
      webhookUrl,
      enabled: input.enabled,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationSettings.userId,
      set: {
        webhookUrl,
        enabled: input.enabled,
        updatedAt: now,
      },
    })
    .returning({
      webhookUrl: notificationSettings.webhookUrl,
      enabled: notificationSettings.enabled,
    })

  return {
    webhookUrl: row!.webhookUrl,
    enabled: row!.enabled,
  }
}

import { getNotificationSettingsForUser } from '../services/notification-settings'
import { requireUser } from '../utils/auth'
import { defineApiHandler } from '../utils/errors'

export default defineApiHandler(async (event) => {
  const { user } = await requireUser(event)
  const settings = await getNotificationSettingsForUser(user.id)
  return { settings }
})

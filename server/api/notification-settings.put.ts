import { putNotificationSettingsSchema } from '../../shared/validation/notification-settings'
import { putNotificationSettingsForUser } from '../services/notification-settings'
import { requireUser } from '../utils/auth'
import { AppError, defineApiHandler } from '../utils/errors'
import { assertStateChangingGuards } from '../utils/request-security'
import { zodFields } from '../utils/responses'

export default defineApiHandler(async (event) => {
  assertStateChangingGuards(event, { jsonBody: true })
  const { user } = await requireUser(event)

  const body = await readBody(event)
  const parsed = putNotificationSettingsSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The request is invalid', zodFields(parsed.error))
  }

  const settings = await putNotificationSettingsForUser(user.id, parsed.data)
  return { settings }
})

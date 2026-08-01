import { createMonitorSchema } from '../../../shared/validation/monitors'
import { createMonitorForUser } from '../../services/monitors'
import { requireUser } from '../../utils/auth'
import { AppError, defineApiHandler } from '../../utils/errors'
import { assertStateChangingGuards } from '../../utils/request-security'
import { zodFields } from '../../utils/responses'

export default defineApiHandler(async (event) => {
  assertStateChangingGuards(event, { jsonBody: true })
  const { user } = await requireUser(event)

  const body = await readBody(event)
  const parsed = createMonitorSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The request is invalid', zodFields(parsed.error))
  }

  const monitor = await createMonitorForUser(user.id, parsed.data)
  setResponseStatus(event, 201)
  return { monitor }
})

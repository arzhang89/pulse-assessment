import { monitorIdSchema, updateMonitorSchema } from '../../../shared/validation/monitors'
import { updateMonitorForUser } from '../../services/monitors'
import { requireUser } from '../../utils/auth'
import { AppError, defineApiHandler } from '../../utils/errors'
import { assertStateChangingGuards } from '../../utils/request-security'
import { zodFields } from '../../utils/responses'

export default defineApiHandler(async (event) => {
  assertStateChangingGuards(event, { jsonBody: true })
  const { user } = await requireUser(event)

  const idParsed = monitorIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!idParsed.success) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found')
  }

  const body = await readBody(event)
  const parsed = updateMonitorSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The request is invalid', zodFields(parsed.error))
  }

  const monitor = await updateMonitorForUser(user.id, idParsed.data, parsed.data)
  return { monitor }
})

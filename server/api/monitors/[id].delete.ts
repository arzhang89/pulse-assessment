import { monitorIdSchema } from '../../../shared/validation/monitors'
import { deleteMonitorForUser } from '../../services/monitors'
import { requireUser } from '../../utils/auth'
import { AppError, defineApiHandler } from '../../utils/errors'
import { assertStateChangingGuards } from '../../utils/request-security'

export default defineApiHandler(async (event) => {
  assertStateChangingGuards(event, { jsonBody: false })
  const { user } = await requireUser(event)

  const idParsed = monitorIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!idParsed.success) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found')
  }

  await deleteMonitorForUser(user.id, idParsed.data)
  setResponseStatus(event, 204)
  return null
})

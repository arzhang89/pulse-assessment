import { monitorIdSchema } from '../../../shared/validation/monitors'
import { getMonitorForUser } from '../../services/monitors'
import { requireUser } from '../../utils/auth'
import { AppError, defineApiHandler } from '../../utils/errors'

export default defineApiHandler(async (event) => {
  const { user } = await requireUser(event)
  const idParsed = monitorIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!idParsed.success) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found')
  }

  const monitor = await getMonitorForUser(user.id, idParsed.data)
  return { monitor }
})

import { monitorHistoryQuerySchema, monitorIdSchema } from '../../../../shared/validation/monitors'
import { listMonitorHistoryForUser } from '../../../services/monitors'
import { requireUser } from '../../../utils/auth'
import { AppError, defineApiHandler } from '../../../utils/errors'
import { zodFields } from '../../../utils/responses'

export default defineApiHandler(async (event) => {
  const { user } = await requireUser(event)

  const idParsed = monitorIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!idParsed.success) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found')
  }

  const queryParsed = monitorHistoryQuerySchema.safeParse(getQuery(event))
  if (!queryParsed.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'The request is invalid',
      zodFields(queryParsed.error),
    )
  }

  const results = await listMonitorHistoryForUser(user.id, idParsed.data, queryParsed.data.limit)
  return { results }
})

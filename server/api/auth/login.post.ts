import { authCredentialsSchema } from '../../../shared/validation/auth'
import { loginUser } from '../../services/auth'
import { setSessionCookie } from '../../utils/auth'
import { AppError, defineApiHandler } from '../../utils/errors'
import { assertStateChangingGuards } from '../../utils/request-security'
import { zodFields } from '../../utils/responses'

export default defineApiHandler(async (event) => {
  assertStateChangingGuards(event, { jsonBody: true })

  const body = await readBody(event)
  const parsed = authCredentialsSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The request is invalid', zodFields(parsed.error))
  }

  const { user, rawSessionToken } = await loginUser(parsed.data)
  setSessionCookie(event, rawSessionToken)
  return { user }
})

import { authCredentialsSchema } from '../../../shared/validation/auth'
import { signupUser } from '../../services/auth'
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

  const { user, rawSessionToken } = await signupUser(parsed.data)
  // Cookie is set only after the user+session transaction has committed.
  setSessionCookie(event, rawSessionToken)
  setResponseStatus(event, 201)
  return { user }
})

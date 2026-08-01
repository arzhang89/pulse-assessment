import { SESSION_COOKIE_NAME } from '../../../shared/session-token'
import { logoutSession } from '../../services/auth'
import { clearSessionCookie } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { assertStateChangingGuards } from '../../utils/request-security'

export default defineApiHandler(async (event) => {
  // Logout has no JSON body, but Origin is still required.
  assertStateChangingGuards(event, { jsonBody: false })

  const rawToken = getCookie(event, SESSION_COOKIE_NAME)
  await logoutSession(rawToken)
  clearSessionCookie(event)
  setResponseStatus(event, 204)
  return null
})

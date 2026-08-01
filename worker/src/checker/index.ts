export {
  performHttpCheck,
  type HttpCheckDependencies,
  type PerformHttpCheckInput,
} from './http-check.js'
export {
  safeHttpRequest,
  type SafeRequestDependencies,
  type SafeRequestInput,
  type SafeRequestResult,
  type DnsLookupFn,
} from './safe-request.js'
export {
  classifyIpAddress,
  dedupeAddresses,
  isForbiddenIpAddress,
  FORBIDDEN_IPV4_RANGES,
  FORBIDDEN_IPV6_RANGES,
  type AddressClassification,
  type ForbiddenReason,
} from './forbidden-addresses.js'
export {
  CHECK_ERROR_CODES,
  MAX_ERROR_MESSAGE_LENGTH,
  type CheckErrorCode,
  type CheckOutcome,
  type HttpCheckResult,
} from './types.js'
export { safeErrorMessage } from './safe-message.js'

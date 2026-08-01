/**
 * Pure monitor status transitions.
 *
 * Thresholds are named constants so flapping behavior stays explicit and
 * table-driven tests can pin every edge. Counters saturate at those
 * thresholds — they never grow unbounded in stored state.
 *
 * Notification intent is expressed only as transition actions:
 * - UNKNOWN → UP: NONE (first success is not a recovery)
 * - confirmed DOWN: OPEN_INCIDENT
 * - confirmed DOWN → UP: RESOLVE_INCIDENT (requires an open incident at apply time)
 */

export const FAILURES_TO_CONFIRM_DOWN = 2
export const SUCCESSES_TO_CONFIRM_RECOVERY = 2

export const MonitorStatus = {
  UNKNOWN: 'UNKNOWN',
  UP: 'UP',
  DOWN: 'DOWN',
} as const

export type MonitorStatus = (typeof MonitorStatus)[keyof typeof MonitorStatus]

export const CheckOutcome = {
  UP: 'UP',
  DOWN: 'DOWN',
} as const

export type CheckOutcome = (typeof CheckOutcome)[keyof typeof CheckOutcome]

export const TransitionAction = {
  NONE: 'NONE',
  OPEN_INCIDENT: 'OPEN_INCIDENT',
  RESOLVE_INCIDENT: 'RESOLVE_INCIDENT',
} as const

export type TransitionAction = (typeof TransitionAction)[keyof typeof TransitionAction]

export type MonitorStatusState = {
  readonly status: MonitorStatus
  readonly consecutiveFailures: number
  readonly consecutiveSuccesses: number
}

export type ApplyCheckResult = {
  nextStatus: MonitorStatus
  nextConsecutiveFailures: number
  nextConsecutiveSuccesses: number
  transition: TransitionAction
}

export function applyCheckResult(
  state: MonitorStatusState,
  outcome: CheckOutcome,
): ApplyCheckResult {
  if (outcome === CheckOutcome.UP) {
    const nextConsecutiveSuccesses = Math.min(
      state.consecutiveSuccesses + 1,
      SUCCESSES_TO_CONFIRM_RECOVERY,
    )
    const nextConsecutiveFailures = 0

    if (
      state.status === MonitorStatus.DOWN &&
      nextConsecutiveSuccesses >= SUCCESSES_TO_CONFIRM_RECOVERY
    ) {
      return {
        nextStatus: MonitorStatus.UP,
        nextConsecutiveFailures,
        nextConsecutiveSuccesses,
        transition: TransitionAction.RESOLVE_INCIDENT,
      }
    }

    if (state.status === MonitorStatus.UNKNOWN) {
      return {
        nextStatus: MonitorStatus.UP,
        nextConsecutiveFailures,
        nextConsecutiveSuccesses,
        transition: TransitionAction.NONE,
      }
    }

    return {
      nextStatus: state.status,
      nextConsecutiveFailures,
      nextConsecutiveSuccesses,
      transition: TransitionAction.NONE,
    }
  }

  const nextConsecutiveFailures = Math.min(state.consecutiveFailures + 1, FAILURES_TO_CONFIRM_DOWN)
  const nextConsecutiveSuccesses = 0

  if (
    (state.status === MonitorStatus.UNKNOWN || state.status === MonitorStatus.UP) &&
    nextConsecutiveFailures >= FAILURES_TO_CONFIRM_DOWN
  ) {
    return {
      nextStatus: MonitorStatus.DOWN,
      nextConsecutiveFailures,
      nextConsecutiveSuccesses,
      transition: TransitionAction.OPEN_INCIDENT,
    }
  }

  return {
    nextStatus: state.status,
    nextConsecutiveFailures,
    nextConsecutiveSuccesses,
    transition: TransitionAction.NONE,
  }
}

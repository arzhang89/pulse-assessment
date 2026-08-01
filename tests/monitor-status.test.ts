import { describe, expect, it } from 'vitest'
import {
  CheckOutcome,
  FAILURES_TO_CONFIRM_DOWN,
  MonitorStatus,
  SUCCESSES_TO_CONFIRM_RECOVERY,
  TransitionAction,
  applyCheckResult,
  type MonitorStatusState,
} from '../shared/monitor-status'

type Case = {
  name: string
  state: MonitorStatusState
  outcome: (typeof CheckOutcome)[keyof typeof CheckOutcome]
  expected: ReturnType<typeof applyCheckResult>
}

const cases: Case[] = [
  {
    name: 'UNKNOWN + first success → UP without notification',
    state: { status: MonitorStatus.UNKNOWN, consecutiveFailures: 0, consecutiveSuccesses: 0 },
    outcome: CheckOutcome.UP,
    expected: {
      nextStatus: MonitorStatus.UP,
      nextConsecutiveFailures: 0,
      nextConsecutiveSuccesses: 1,
      transition: TransitionAction.NONE,
    },
  },
  {
    name: 'UNKNOWN + first failure → remain UNKNOWN',
    state: { status: MonitorStatus.UNKNOWN, consecutiveFailures: 0, consecutiveSuccesses: 0 },
    outcome: CheckOutcome.DOWN,
    expected: {
      nextStatus: MonitorStatus.UNKNOWN,
      nextConsecutiveFailures: 1,
      nextConsecutiveSuccesses: 0,
      transition: TransitionAction.NONE,
    },
  },
  {
    name: 'UNKNOWN + second consecutive failure → DOWN + OPEN_INCIDENT',
    state: { status: MonitorStatus.UNKNOWN, consecutiveFailures: 1, consecutiveSuccesses: 0 },
    outcome: CheckOutcome.DOWN,
    expected: {
      nextStatus: MonitorStatus.DOWN,
      nextConsecutiveFailures: FAILURES_TO_CONFIRM_DOWN,
      nextConsecutiveSuccesses: 0,
      transition: TransitionAction.OPEN_INCIDENT,
    },
  },
  {
    name: 'UP + first failure → remain UP',
    state: { status: MonitorStatus.UP, consecutiveFailures: 0, consecutiveSuccesses: 2 },
    outcome: CheckOutcome.DOWN,
    expected: {
      nextStatus: MonitorStatus.UP,
      nextConsecutiveFailures: 1,
      nextConsecutiveSuccesses: 0,
      transition: TransitionAction.NONE,
    },
  },
  {
    name: 'UP + second consecutive failure → DOWN + OPEN_INCIDENT',
    state: { status: MonitorStatus.UP, consecutiveFailures: 1, consecutiveSuccesses: 0 },
    outcome: CheckOutcome.DOWN,
    expected: {
      nextStatus: MonitorStatus.DOWN,
      nextConsecutiveFailures: FAILURES_TO_CONFIRM_DOWN,
      nextConsecutiveSuccesses: 0,
      transition: TransitionAction.OPEN_INCIDENT,
    },
  },
  {
    name: 'DOWN + first success → remain DOWN',
    state: { status: MonitorStatus.DOWN, consecutiveFailures: 2, consecutiveSuccesses: 0 },
    outcome: CheckOutcome.UP,
    expected: {
      nextStatus: MonitorStatus.DOWN,
      nextConsecutiveFailures: 0,
      nextConsecutiveSuccesses: 1,
      transition: TransitionAction.NONE,
    },
  },
  {
    name: 'DOWN + second consecutive success → UP + RESOLVE_INCIDENT',
    state: { status: MonitorStatus.DOWN, consecutiveFailures: 0, consecutiveSuccesses: 1 },
    outcome: CheckOutcome.UP,
    expected: {
      nextStatus: MonitorStatus.UP,
      nextConsecutiveFailures: 0,
      nextConsecutiveSuccesses: SUCCESSES_TO_CONFIRM_RECOVERY,
      transition: TransitionAction.RESOLVE_INCIDENT,
    },
  },
  {
    name: 'DOWN + another failure remains DOWN with failures capped at 2',
    state: { status: MonitorStatus.DOWN, consecutiveFailures: 2, consecutiveSuccesses: 0 },
    outcome: CheckOutcome.DOWN,
    expected: {
      nextStatus: MonitorStatus.DOWN,
      nextConsecutiveFailures: 2,
      nextConsecutiveSuccesses: 0,
      transition: TransitionAction.NONE,
    },
  },
  {
    name: 'UP + another success remains UP with successes capped at 2',
    state: { status: MonitorStatus.UP, consecutiveFailures: 0, consecutiveSuccesses: 2 },
    outcome: CheckOutcome.UP,
    expected: {
      nextStatus: MonitorStatus.UP,
      nextConsecutiveFailures: 0,
      nextConsecutiveSuccesses: 2,
      transition: TransitionAction.NONE,
    },
  },
  {
    name: 'alternating failure after successes resets success counter',
    state: { status: MonitorStatus.UP, consecutiveFailures: 0, consecutiveSuccesses: 2 },
    outcome: CheckOutcome.DOWN,
    expected: {
      nextStatus: MonitorStatus.UP,
      nextConsecutiveFailures: 1,
      nextConsecutiveSuccesses: 0,
      transition: TransitionAction.NONE,
    },
  },
  {
    name: 'alternating success after a failure resets failure counter',
    state: { status: MonitorStatus.UP, consecutiveFailures: 1, consecutiveSuccesses: 0 },
    outcome: CheckOutcome.UP,
    expected: {
      nextStatus: MonitorStatus.UP,
      nextConsecutiveFailures: 0,
      nextConsecutiveSuccesses: 1,
      transition: TransitionAction.NONE,
    },
  },
]

describe('applyCheckResult', () => {
  it.each(cases)('$name', ({ state, outcome, expected }) => {
    expect(applyCheckResult(state, outcome)).toEqual(expected)
  })

  it('does not mutate the input state object', () => {
    const state: MonitorStatusState = {
      status: MonitorStatus.UNKNOWN,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    }
    const snapshot = structuredClone(state)

    applyCheckResult(state, CheckOutcome.UP)

    expect(state).toEqual(snapshot)
  })

  it('flapping UP/DOWN/UP does not open an incident without two consecutive failures', () => {
    let state: MonitorStatusState = {
      status: MonitorStatus.UP,
      consecutiveFailures: 0,
      consecutiveSuccesses: 2,
    }

    const afterFailure = applyCheckResult(state, CheckOutcome.DOWN)
    expect(afterFailure.transition).toBe(TransitionAction.NONE)
    state = {
      status: afterFailure.nextStatus,
      consecutiveFailures: afterFailure.nextConsecutiveFailures,
      consecutiveSuccesses: afterFailure.nextConsecutiveSuccesses,
    }

    const afterSuccess = applyCheckResult(state, CheckOutcome.UP)
    expect(afterSuccess).toEqual({
      nextStatus: MonitorStatus.UP,
      nextConsecutiveFailures: 0,
      nextConsecutiveSuccesses: 1,
      transition: TransitionAction.NONE,
    })
  })
})

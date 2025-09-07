import MetricsTracker from './MetricsTracker.js'
import FileLogger from '../utils/fileLogger.js'
import { intentStore, IntentRow } from './IntentStore.js'
import { IntentState, ReasonCode } from '../../dto/src/enums'
import { getReason } from '../../dto/src/reasons'

type FSMResult = { ok: boolean; row: IntentRow; reason?: ReturnType<typeof getReason> }

/**
 * IntentFSM
 * Centralized, deterministic state transition helper.
 * - enforces allowed transitions
 * - idempotent updates (no-op when already at target)
 * - logs with corr_id and request_hash
 * - updates Prometheus metrics via MetricsTracker
 */
class IntentFSM {
  private metrics = MetricsTracker.getInstance()
  private logger = FileLogger.getInstance()

  // allowed transitions map
  private allowed: Record<string, string[]> = {
    RECEIVED: ['SCREENED', 'REJECTED'],
    SCREENED: ['VALIDATED', 'REJECTED'],
    VALIDATED: ['ENRICHED', 'REJECTED'],
    ENRICHED: ['QUEUED', 'REJECTED'],
    QUEUED: ['SUBMITTED', 'REJECTED'],
    SUBMITTED: ['INCLUDED', 'DROPPED'],
    INCLUDED: [],
    DROPPED: [],
    REJECTED: []
  }

  transition(intent_id: string, target: IntentState, reasonCode?: ReasonCode, context?: Record<string, unknown>): FSMResult {
    const row = intentStore.getById(intent_id)
    if (!row) throw new Error('intent not found')

    // idempotent: if already at target, return current
    if (row.state === target) return { ok: true, row }

    const allowedNext = this.allowed[row.state] || []
    if (!allowedNext.includes(target)) {
      // illegal transition: mark internal error and return
      const reason = getReason('INTERNAL_ERROR')
      void this.logger.logFailure({ event: 'illegal_transition', intent_id, from: row.state, to: target, corr_id: row.correlation_id, request_hash: row.request_hash })
      this.metrics.recordError(reason.code)
      row.state = 'REJECTED'
      row.reason_code = reason.code
      intentStore.put(row)
      return { ok: false, row, reason }
    }

    // Apply transition
    row.state = target
    if (reasonCode) row.reason_code = reasonCode
    intentStore.put(row)

    // Logging and metrics
    void this.logger.logSuccess({ event: 'state_transition', intent_id, to: target, corr_id: row.correlation_id, request_hash: row.request_hash, context })
    this.metrics.observeStage(target.toLowerCase(), Date.now() - (row.received_at || Date.now()))
    return { ok: true, row }
  }
}

export const intentFSM = new IntentFSM()

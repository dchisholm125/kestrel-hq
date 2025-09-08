import MetricsTracker from './MetricsTracker'
import FileLogger from '../utils/fileLogger'
import { intentStore, IntentRow } from './IntentStore'
import { IntentState, ReasonCode, getReason } from '@kestrel-hq/dto'
import { advanceIntent } from '../fsm/transitionExecutor'

type FSMResult = { ok: boolean; row: IntentRow; reason?: ReturnType<typeof getReason> }

/**
 * IntentFSM
 * - deterministic single-gate state moves via DB-backed executor when available
 * - enforces monotonic single-step transitions
 * - idempotent (re-invoking a handler for the same target is a no-op)
 * - fail-fast to REJECTED with ReasonDetail on guard failures
 */
class IntentFSM {
  private metrics = MetricsTracker.getInstance()
  private logger = FileLogger.getInstance()

  // single-step allowed transitions (subset enforced here for fast local checks)
  private allowed: Record<string, string[]> = {
    RECEIVED: ['SCREENED'],
    SCREENED: ['VALIDATED', 'REJECTED'],
    VALIDATED: ['ENRICHED', 'REJECTED'],
    ENRICHED: ['QUEUED', 'REJECTED'],
    QUEUED: ['SUBMITTED'],
    SUBMITTED: ['INCLUDED', 'DROPPED'],
    INCLUDED: [],
    DROPPED: [],
    REJECTED: []
  }

  async transition(intent_id: string, target: IntentState, reasonCode?: ReasonCode, context?: Record<string, unknown>): Promise<FSMResult> {
    const row = intentStore.getById(intent_id)
    if (!row) throw new Error('intent not found')

    // idempotency: no-op if already at target
    if (row.state === target) return { ok: true, row }

    const allowedNext = this.allowed[row.state] || []
    if (!allowedNext.includes(target)) {
      // illegal transition: fail-fast to REJECTED with INTERNAL_ERROR
      const reason = getReason('INTERNAL_ERROR')
      void this.logger.logFailure({ event: 'illegal_transition', intent_id, from: row.state, to: target, corr_id: row.correlation_id, request_hash: row.request_hash, context })
      this.metrics.recordError(reason.code)
      // update in-memory store for local dev flow
      row.state = 'REJECTED'
      row.reason_code = reason.code
      intentStore.put(row)
      return { ok: false, row, reason }
    }

    // Record SUBMIT_NOT_ATTEMPTED when code path would have submitted but we are in a 'no submit' mode
    if (row.state === 'QUEUED' && target === 'SUBMITTED') {
      // For now, if submission isn't actually attempted, set a marker reason code
      // The caller may pass a reasonCode; prefer that.
      if (!reasonCode) reasonCode = 'SUBMIT_NOT_ATTEMPTED' as ReasonCode
    }

    // Try DB-backed advance; if DB unavailable, fall back to in-memory update
    try {
      await advanceIntent({ intentId: intent_id, to: target, corr_id: row.correlation_id, request_hash: row.request_hash, reason: reasonCode ? { code: reasonCode } : undefined })
      // on success, update in-memory copy
      row.state = target
      if (reasonCode) row.reason_code = reasonCode
      intentStore.put(row)
    } catch (e) {
      // optimistic lock or invalid transition should be surfaced upstream; map to REJECTED conservatively
      const reason = getReason('INTERNAL_ERROR')
      void this.logger.logFailure({ event: 'transition_failure', intent_id, error: (e as any)?.message, corr_id: row.correlation_id, request_hash: row.request_hash, context })
      this.metrics.recordError(reason.code)
      row.state = 'REJECTED'
      row.reason_code = reason.code
      intentStore.put(row)
      return { ok: false, row, reason }
    }

    void this.logger.logSuccess({ event: 'state_transition', intent_id, to: target, corr_id: row.correlation_id, request_hash: row.request_hash, context })
    this.metrics.observeStage((target as string).toLowerCase(), Date.now() - (row.received_at || Date.now()))
    return { ok: true, row }
  }
}

export const intentFSM = new IntentFSM()

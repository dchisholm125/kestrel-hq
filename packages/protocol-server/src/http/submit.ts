/**
 * POST /intent handler
 *
 * This handler implements a deterministic, single-rung advancement of the
 * conveyor for simple testing and deterministic control in unit tests.
 * Why one rung per handler? Keeping each handler limited to a single
 * observable decision makes it easier to reason about ordering, retries,
 * and idempotency: callers can re-post to observe the next decision without
 * the server performing complex multi-step implicit retries.
 */
import { Request, Response } from 'express'
import MetricsTracker from '../services/MetricsTracker'
import { intentStore } from '../services/IntentStore'
import { ulid } from 'ulid'
import { getReason } from '@kestrel/dto'
import { ReasonedRejection } from '@kestrel/reasons'
import { appendRejection } from '../utils/rejectionAudit'
import { advanceIntent } from '../fsm/transitionExecutor'
import { IntentState, ErrorEnvelope } from '@kestrel/dto'
import { getEdgeModules } from '../edge/loader'
import { submitPath } from '../pipeline/submitPath'

export async function postIntent(req: Request, res: Response) {
  // lazy-load metrics tracker so tests can override the module at runtime
  const metrics = require('../services/MetricsTracker').default.getInstance()
  const start = Date.now()
  const corr_id = (req as any).corr_id || `corr_${ulid()}`
  const body = req.body || {}

  // minimal schema: intent_id required
  if (!body.intent_id) {
    metrics.incReject('schema')
    const reason = getReason('CLIENT_BAD_REQUEST')
    const envelope: ErrorEnvelope = { corr_id, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
    return res.status(reason.http_status).json(envelope)
  }

  const intent_id = body.intent_id
  const request_hash = intentStore.computeHash(body)

  // idempotency by hash: return stored row if duplicate body
  const recent = intentStore.getByHash(request_hash)
  if (recent) {
    const storedPayload = recent.payload
    const incomingCanonical = intentStore.computeHash(body)
    const storedCanonical = intentStore.computeHash(storedPayload)
    if (incomingCanonical === storedCanonical) {
      metrics.incIdempotencyHit()
      return res.status(200).json({ intent_id: recent.intent_id, state: recent.state, request_hash: recent.request_hash, correlation_id: recent.correlation_id })
    }
    const reason = getReason('SCREEN_REPLAY_SEEN')
    const envelope: ErrorEnvelope = { corr_id: recent.correlation_id, request_hash: recent.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
    return res.status(reason.http_status).json(envelope)
  }

  const correlation_id = corr_id
  const row = { intent_id, request_hash, correlation_id, state: IntentState.RECEIVED, reason_code: 'ok', received_at: Date.now(), payload: body }
  intentStore.put(row)

  // run pipeline synchronously in-process, timing each stage and calling metrics
  const ctx: any = { intent: row, corr_id: correlation_id, request_hash, cfg: {}, cache: {}, queue: { enqueue: async () => true } }

  try {
  const sStart = Date.now()
  // lazy-require stages to avoid pulling heavy DB deps during module import
  const { screenIntent } = require('../stages/screen')
  try {
    const r = await screenIntent(ctx)
    if (r?.next) {
      await advanceIntent({ intentId: intent_id, to: r.next, corr_id: correlation_id, request_hash })
    }
  } catch (e) {
    if (e instanceof ReasonedRejection) {
      await advanceIntent({ intentId: intent_id, to: IntentState.REJECTED, corr_id: correlation_id, request_hash, reason: e.reason })
      await appendRejection({ ts: new Date().toISOString(), corr_id: correlation_id, intent_id, stage: 'screen', reason: { code: e.reason.code, category: e.reason.category, http_status: e.reason.http_status, message: e.reason.message }, context: e.reason.context })
    } else { throw e }
  }
  try { console.debug('[postIntent] observeStage screen about to call') } catch (e) {}
  metrics.observeStage('screen', Date.now() - sStart)
    let updated = intentStore.getById(intent_id)
    if (updated?.state === IntentState.REJECTED) {
      const reason = getReason(updated.reason_code as any) || getReason('INTERNAL_ERROR')
      const env: ErrorEnvelope = { corr_id: updated.correlation_id, request_hash: updated.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      return res.status(reason.http_status).json(env)
    }

  const vStart = Date.now()
  const { validateIntent } = require('../stages/validate')
  try {
    const r = await validateIntent(ctx)
    if (r?.next) await advanceIntent({ intentId: intent_id, to: r.next, corr_id: correlation_id, request_hash })
  } catch (e) {
    if (e instanceof ReasonedRejection) {
      await advanceIntent({ intentId: intent_id, to: IntentState.REJECTED, corr_id: correlation_id, request_hash, reason: e.reason })
      await appendRejection({ ts: new Date().toISOString(), corr_id: correlation_id, intent_id, stage: 'validate', reason: { code: e.reason.code, category: e.reason.category, http_status: e.reason.http_status, message: e.reason.message }, context: e.reason.context })
    } else { throw e }
  }
  try { console.debug('[postIntent] observeStage validate about to call') } catch (e) {}
  metrics.observeStage('validate', Date.now() - vStart)
    updated = intentStore.getById(intent_id)
    if (updated?.state === IntentState.REJECTED) {
      const reason = getReason(updated.reason_code as any) || getReason('INTERNAL_ERROR')
      const env: ErrorEnvelope = { corr_id: updated.correlation_id, request_hash: updated.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      return res.status(reason.http_status).json(env)
    }

  const eStart = Date.now()
  const { enrichIntent } = require('../stages/enrich')
  try {
    const r = await enrichIntent(ctx)
    if (r?.next) await advanceIntent({ intentId: intent_id, to: r.next, corr_id: correlation_id, request_hash })
  } catch (e) {
    if (e instanceof ReasonedRejection) {
      await advanceIntent({ intentId: intent_id, to: IntentState.REJECTED, corr_id: correlation_id, request_hash, reason: e.reason })
      await appendRejection({ ts: new Date().toISOString(), corr_id: correlation_id, intent_id, stage: 'enrich', reason: { code: e.reason.code, category: e.reason.category, http_status: e.reason.http_status, message: e.reason.message }, context: e.reason.context })
    } else { throw e }
  }
  try { console.debug('[postIntent] observeStage enrich about to call') } catch (e) {}
  metrics.observeStage('enrich', Date.now() - eStart)
    updated = intentStore.getById(intent_id)
    if (updated?.state === IntentState.REJECTED) {
      const reason = getReason(updated.reason_code as any) || getReason('INTERNAL_ERROR')
      const env: ErrorEnvelope = { corr_id: updated.correlation_id, request_hash: updated.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      return res.status(reason.http_status).json(env)
    }

  const pStart = Date.now()
  const { policyIntent } = require('../stages/policy')
  try {
    const r = await policyIntent(ctx)
    if (r?.next) await advanceIntent({ intentId: intent_id, to: r.next, corr_id: correlation_id, request_hash })
  } catch (e) {
    if (e instanceof ReasonedRejection) {
      await advanceIntent({ intentId: intent_id, to: IntentState.REJECTED, corr_id: correlation_id, request_hash, reason: e.reason })
      await appendRejection({ ts: new Date().toISOString(), corr_id: correlation_id, intent_id, stage: 'policy', reason: { code: e.reason.code, category: e.reason.category, http_status: e.reason.http_status, message: e.reason.message }, context: e.reason.context })
    } else { throw e }
  }
  try { console.debug('[postIntent] observeStage policy about to call') } catch (e) {}
  metrics.observeStage('policy', Date.now() - pStart)
    updated = intentStore.getById(intent_id)
    if (updated?.state === IntentState.REJECTED) {
      const reason = getReason(updated.reason_code as any) || getReason('INTERNAL_ERROR')
      const env: ErrorEnvelope = { corr_id: updated.correlation_id, request_hash: updated.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      return res.status(reason.http_status).json(env)
    }

    // Post-QUEUED submission guard: same behavior as non-modular handler.
    try {
      const edge = await getEdgeModules()
      await submitPath({ edge, intent: { intent_id }, corr_id: correlation_id, request_hash })
    } catch (e) {
      if (e instanceof ReasonedRejection && e.reason.code === 'SUBMIT_NOT_ATTEMPTED') {
        // intentional no-op in public builds
      } else {
        throw e
      }
    }

    const final = intentStore.getById(intent_id)
    const elapsed = Date.now() - start
    metrics.observeDecisionLatency(elapsed)
    metrics.incrementAccepted()
    metrics.incrementReceived()

  return res.status(201).json({ intent_id, state: final?.state ?? IntentState.RECEIVED, correlation_id })
  } catch (e) {
  // surface the error for test visibility
  // eslint-disable-next-line no-console
  console.error('[postIntent] unexpected error', (e as any)?.stack || e)
    // ensure stored row is marked rejected
    const stored = intentStore.getById(intent_id)
    if (stored) {
      stored.state = IntentState.REJECTED
      stored.reason_code = 'INTERNAL_ERROR'
      intentStore.put(stored)
    }
    const reason = getReason('INTERNAL_ERROR')
    const env: ErrorEnvelope = { corr_id: stored?.correlation_id ?? correlation_id, request_hash: stored?.request_hash ?? request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
    return res.status(reason.http_status).json(env)
  }
}

export default postIntent

/* This stage performs policy checks on incoming intents, including
   account allowlists and queue capacity/backpressure.

   On success, intent is moved to QUEUED state.
   On failure, intent is moved to REJECTED with appropriate reason.
*/

import { advanceIntent } from '../fsm/transitionExecutor'
import { IntentState, ReasonCategory } from '../../../dto/src/enums'

type Ctx = {
  intent: any
  corr_id: string
  request_hash?: string
  cfg: any
  queue?: { capacity?: number; enqueue?: (intent: any) => Promise<boolean> }
}

export async function policyIntent(ctx: Ctx) {
  const { intent, corr_id, request_hash } = ctx

  // simple policy checks: account and asset allowlists
  if (ctx.cfg?.policy?.allowedAccounts && Array.isArray(ctx.cfg.policy.allowedAccounts)) {
    const acct = intent.payload?.from
    if (acct && !ctx.cfg.policy.allowedAccounts.includes(acct)) {
      return advanceIntent({
        intentId: intent.intent_id || intent.id,
        to: IntentState.REJECTED,
        corr_id,
        request_hash,
        reason: {
          code: 'POLICY_ACCOUNT_NOT_ALLOWED',
          category: ReasonCategory.POLICY,
          http_status: 403,
          message: 'account not permitted',
        },
      })
    }
  }

  // backpressure / queue capacity check
  if (ctx.queue && typeof ctx.queue.enqueue === 'function') {
    const capacity = ctx.queue.capacity ?? ctx.cfg?.queueCapacity ?? 100
    if (capacity <= 0) {
      return advanceIntent({
        intentId: intent.intent_id || intent.id,
        to: IntentState.REJECTED,
        corr_id,
        request_hash,
        reason: {
          code: 'QUEUE_CAPACITY',
          category: ReasonCategory.QUEUE,
          http_status: 503,
          message: 'queue full',
        },
      })
    }

    // attempt to enqueue (if returns false, treat as backpressure)
    try {
      const ok = await ctx.queue.enqueue(intent)
      if (!ok) {
        return advanceIntent({
          intentId: intent.intent_id || intent.id,
          to: IntentState.REJECTED,
          corr_id,
          request_hash,
          reason: {
            code: 'QUEUE_CAPACITY',
            category: ReasonCategory.QUEUE,
            http_status: 503,
            message: 'queue backpressure',
          },
        })
      }
    } catch (e) {
      return advanceIntent({
        intentId: intent.intent_id || intent.id,
        to: IntentState.REJECTED,
        corr_id,
        request_hash,
        reason: {
          code: 'INTERNAL_ERROR',
          category: ReasonCategory.QUEUE,
          http_status: 500,
          message: 'queue enqueue failed',
        },
      })
    }
  }

  return advanceIntent({ intentId: intent.intent_id || intent.id, to: IntentState.QUEUED, corr_id, request_hash })
}

export default policyIntent

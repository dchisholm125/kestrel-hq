/* This stage performs policy checks on incoming intents, including
   account allowlists and queue capacity/backpressure.

   On success, intent is moved to QUEUED state.
   On failure, intent is moved to REJECTED with appropriate reason.
*/

import { IntentState, ReasonCategory } from '@kestrel/dto'
import { reason } from '@kestrel/reasons'
import { ReasonedRejection } from '@kestrel/reasons'

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
      throw new ReasonedRejection(
        reason('POLICY_ACCOUNT_NOT_ALLOWED', { message: 'account not permitted' }),
        'Rejecting at POLICY: account not allowed'
      )
    }
  }

  // backpressure / queue capacity check
  if (ctx.queue && typeof ctx.queue.enqueue === 'function') {
    const capacity = ctx.queue.capacity ?? ctx.cfg?.queueCapacity ?? 100
    if (capacity <= 0) {
      throw new ReasonedRejection(
        reason('QUEUE_CAPACITY', { message: 'queue full' }),
        'Rejecting at QUEUE: capacity full'
      )
    }

    // attempt to enqueue (if returns false, treat as backpressure)
    try {
      const ok = await ctx.queue.enqueue(intent)
      if (!ok) {
        throw new ReasonedRejection(
          reason('QUEUE_CAPACITY', { message: 'queue backpressure' }),
          'Rejecting at QUEUE: backpressure'
        )
      }
    } catch (e) {
      throw new ReasonedRejection(
        reason('INTERNAL_ERROR', { message: 'queue enqueue failed' }),
        'Rejecting at QUEUE: enqueue failed'
      )
    }
  }

  return { next: IntentState.QUEUED }
}

export default policyIntent

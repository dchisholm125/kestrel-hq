/* This file runs a quick screening of incoming intents to catch
   obviously bad ones before they hit the main FSM.
   
   Checks include:
   - maxBytes limit
   - replay (request_hash) check via cache
   - deadline sanity check
   - optional rate limiting hook
   
   On failure, intent is moved to REJECTED with appropriate reason.
   On success, intent is moved to SCREENED.
*/

import { IntentState, ReasonCategory } from '@kestrel/dto'
import { reason } from '@kestrel/reasons'
import { ReasonedRejection } from '@kestrel/reasons'

type Ctx = {
  intent: any
  corr_id: string
  request_hash?: string
  cfg: any
  cache: { seen: (hash: string) => Promise<boolean> }
}

export async function screenIntent(ctx: Ctx) {
  const { intent, corr_id, request_hash } = ctx

  // size check
  if (intent.bytes != null && ctx.cfg?.limits?.maxBytes && intent.bytes > ctx.cfg.limits.maxBytes) {
    throw new ReasonedRejection(
      reason('SCREEN_TOO_LARGE', { message: 'payload exceeds maxBytes', context: { maxBytes: ctx.cfg.limits.maxBytes, got: intent.bytes } }),
    'Rejecting at SCREEN: payload exceeds maxBytes'
    )
  }

  // replay check (cache-backed)
  if (request_hash && ctx.cache && typeof ctx.cache.seen === 'function') {
    if (await ctx.cache.seen(request_hash)) {
      throw new ReasonedRejection(
        reason('SCREEN_REPLAY_SEEN', { http_status: 409, message: 'duplicate request_hash with differing body' }),
        'Rejecting at SCREEN: replay seen'
      )
    }
  }

  // ttl / deadline check (assumes intent.payload.deadline_ms)
  const deadline = intent.payload?.deadline_ms ?? intent.deadline_ms
  if (deadline != null && ctx.cfg?.limits?.minDeadlineMs != null) {
    const now = Date.now()
    if (deadline < now) {
      throw new ReasonedRejection(
        reason('CLIENT_EXPIRED', { message: 'deadline already passed', context: { now, deadline } }),
        'Rejecting at SCREEN: deadline passed'
      )
    }
  }

  // Rate limiting check (optional hook provided by ctx)
  if (ctx.cfg?.limits?.rateLimit && typeof (ctx as any).rateLimiter === 'object') {
    try {
      const limited = await (ctx as any).rateLimiter.check(intent)
      if (limited) {
        throw new ReasonedRejection(
          reason('SCREEN_RATE_LIMIT', { message: 'rate limit exceeded' }),
          'Rejecting at SCREEN: rate limit exceeded'
        )
      }
    } catch (e) {
      // if rate limiter fails, fail-fast to REJECTED
      throw new ReasonedRejection(
        reason('INTERNAL_ERROR', { message: 'rate limiter failure' }),
        'Rejecting at SCREEN: rate limiter failure'
      )
    }
  }

  // passed screening
  return { next: IntentState.SCREENED }
}

export default screenIntent

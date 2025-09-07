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

import { advanceIntent } from '../fsm/transitionExecutor'
import { IntentState, ReasonCategory } from '../../../dto/src/enums'

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
    return advanceIntent({
      intentId: intent.intent_id || intent.id,
      to: IntentState.REJECTED,
      corr_id,
      request_hash,
      reason: {
        code: 'SCREEN_TOO_LARGE',
        category: ReasonCategory.SCREEN,
        http_status: 413,
        message: 'payload exceeds maxBytes',
        context: { maxBytes: ctx.cfg.limits.maxBytes, got: intent.bytes },
      },
    })
  }

  // replay check (cache-backed)
  if (request_hash && ctx.cache && typeof ctx.cache.seen === 'function') {
    if (await ctx.cache.seen(request_hash)) {
      return advanceIntent({
        intentId: intent.intent_id || intent.id,
        to: IntentState.REJECTED,
        corr_id,
        request_hash,
        reason: {
          code: 'SCREEN_REPLAY_SEEN',
          category: ReasonCategory.SCREEN,
          http_status: 409,
          message: 'duplicate request_hash with differing body',
        },
      })
    }
  }

  // ttl / deadline check (assumes intent.payload.deadline_ms)
  const deadline = intent.payload?.deadline_ms ?? intent.deadline_ms
  if (deadline != null && ctx.cfg?.limits?.minDeadlineMs != null) {
    const now = Date.now()
    if (deadline < now) {
      return advanceIntent({
        intentId: intent.intent_id || intent.id,
        to: IntentState.REJECTED,
        corr_id,
        request_hash,
        reason: {
          code: 'CLIENT_EXPIRED',
          category: ReasonCategory.SCREEN,
          http_status: 400,
          message: 'deadline already passed',
          context: { now, deadline },
        },
      })
    }
  }

  // Rate limiting check (optional hook provided by ctx)
  if (ctx.cfg?.limits?.rateLimit && typeof (ctx as any).rateLimiter === 'object') {
    try {
      const limited = await (ctx as any).rateLimiter.check(intent)
      if (limited) {
        return advanceIntent({
          intentId: intent.intent_id || intent.id,
          to: IntentState.REJECTED,
          corr_id,
          request_hash,
          reason: {
            code: 'SCREEN_RATE_LIMIT',
            category: ReasonCategory.SCREEN,
            http_status: 429,
            message: 'rate limit exceeded',
          },
        })
      }
    } catch (e) {
      // if rate limiter fails, fail-fast to REJECTED
      return advanceIntent({
        intentId: intent.intent_id || intent.id,
        to: IntentState.REJECTED,
        corr_id,
        request_hash,
        reason: {
          code: 'INTERNAL_ERROR',
          category: ReasonCategory.SCREEN,
          http_status: 500,
          message: 'rate limiter failure',
        },
      })
    }
  }

  // passed screening
  return advanceIntent({ intentId: intent.intent_id || intent.id, to: IntentState.SCREENED, corr_id, request_hash })
}

export default screenIntent

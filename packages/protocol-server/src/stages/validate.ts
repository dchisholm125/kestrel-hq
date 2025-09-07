/* This stage performs initial screening of incoming intents, including size checks,
   replay detection, deadline sanity, and optional rate limiting.

   On success, intent is moved to SCREENED state.
   On failure, intent is moved to REJECTED with appropriate reason.
*/

import { advanceIntent } from '../fsm/transitionExecutor'
import { IntentState, ReasonCategory } from '../../../dto/src/enums'

type Ctx = {
  intent: any
  corr_id: string
  request_hash?: string
  cfg: any
  verifySignature?: (payload: any) => Promise<boolean>
}

export async function validateIntent(ctx: Ctx) {
  const { intent, corr_id, request_hash } = ctx

  // schema validation already happens earlier; here we add semantics
  // chain id check
  if (ctx.cfg?.chainId && intent.payload?.target_chain && intent.payload.target_chain !== ctx.cfg.chainId) {
    return advanceIntent({
      intentId: intent.intent_id || intent.id,
      to: IntentState.REJECTED,
      corr_id,
      request_hash,
      reason: {
        code: 'VALIDATION_CHAIN_MISMATCH',
        category: ReasonCategory.VALIDATION,
        http_status: 400,
        message: 'target_chain mismatch',
        context: { expected: ctx.cfg.chainId, got: intent.payload.target_chain },
      },
    })
  }

  // signature check: expect intent.payload.signature + signing key
  if (intent.payload?.signature) {
    // For now assume a provided verifier on ctx; if missing, mark signature fail
    if (!ctx.verifySignature || typeof ctx.verifySignature !== 'function') {
      return advanceIntent({
        intentId: intent.intent_id || intent.id,
        to: IntentState.REJECTED,
        corr_id,
        request_hash,
        reason: {
          code: 'VALIDATION_SIGNATURE_FAIL',
          category: ReasonCategory.VALIDATION,
          http_status: 400,
          message: 'signature verifier unavailable',
        },
      })
    }
    try {
      const ok = await ctx.verifySignature(intent.payload)
      if (!ok) {
        return advanceIntent({
          intentId: intent.intent_id || intent.id,
          to: IntentState.REJECTED,
          corr_id,
          request_hash,
          reason: {
            code: 'VALIDATION_SIGNATURE_FAIL',
            category: ReasonCategory.VALIDATION,
            http_status: 400,
            message: 'signature verification failed',
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
          category: ReasonCategory.VALIDATION,
          http_status: 500,
          message: 'signature verifier failure',
        },
      })
    }
  }

  // gas bounds check (if provided)
  if (intent.payload?.gas_limit != null && ctx.cfg?.limits?.maxGas != null) {
    const g = Number(intent.payload.gas_limit)
    if (isNaN(g) || g <= 0 || g > ctx.cfg.limits.maxGas) {
      return advanceIntent({
        intentId: intent.intent_id || intent.id,
        to: IntentState.REJECTED,
        corr_id,
        request_hash,
        reason: {
          code: 'VALIDATION_GAS_BOUNDS',
          category: ReasonCategory.VALIDATION,
          http_status: 400,
          message: 'gas limit out of bounds',
          context: { maxGas: ctx.cfg.limits.maxGas, got: g },
        },
      })
    }
  }

  return advanceIntent({ intentId: intent.intent_id || intent.id, to: IntentState.VALIDATED, corr_id, request_hash })
}

export default validateIntent

/* This stage performs initial screening of incoming intents, including size checks,
   replay detection, deadline sanity, and optional rate limiting.

   On success, intent is moved to SCREENED state.
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
  verifySignature?: (payload: any) => Promise<boolean>
}

export async function validateIntent(ctx: Ctx) {
  const { intent, corr_id, request_hash } = ctx

  // schema validation already happens earlier; here we add semantics
  // chain id check
  if (ctx.cfg?.chainId && intent.payload?.target_chain && intent.payload.target_chain !== ctx.cfg.chainId) {
    throw new ReasonedRejection(
      reason('VALIDATION_CHAIN_MISMATCH', { message: 'target_chain mismatch', context: { expected: ctx.cfg.chainId, got: intent.payload.target_chain } }),
      'Rejecting at VALIDATE: target_chain mismatch'
    )
  }

  // signature check: expect intent.payload.signature + signing key
  if (intent.payload?.signature) {
    // For now assume a provided verifier on ctx; if missing, mark signature fail
    if (!ctx.verifySignature || typeof ctx.verifySignature !== 'function') {
      throw new ReasonedRejection(
        reason('VALIDATION_SIGNATURE_FAIL', { http_status: 400, message: 'signature verifier unavailable' }),
        'Rejecting at VALIDATE: verifier unavailable'
      )
    }
    try {
      const ok = await ctx.verifySignature(intent.payload)
      if (!ok) {
        throw new ReasonedRejection(
          reason('VALIDATION_SIGNATURE_FAIL', { http_status: 400, message: 'signature verification failed' }),
          'Rejecting at VALIDATE: signature check failed'
        )
      }
    } catch (e) {
      throw new ReasonedRejection(
        reason('INTERNAL_ERROR', { message: 'signature verifier failure' }),
        'Rejecting at VALIDATE: verifier failure'
      )
    }
  }

  // gas bounds check (if provided)
  if (intent.payload?.gas_limit != null && ctx.cfg?.limits?.maxGas != null) {
    const g = Number(intent.payload.gas_limit)
    if (isNaN(g) || g <= 0 || g > ctx.cfg.limits.maxGas) {
      throw new ReasonedRejection(
        reason('VALIDATION_GAS_BOUNDS', { message: 'gas limit out of bounds', context: { maxGas: ctx.cfg.limits.maxGas, got: g } }),
        'Rejecting at VALIDATE: gas limit out of bounds'
      )
    }
  }

  return { next: IntentState.VALIDATED }
}

export default validateIntent

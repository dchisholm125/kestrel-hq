/* This stage enriches the intent with derived fields, such as
   normalized addresses and fee ceiling estimates.

   On success, intent is moved to ENRICHED state.
*/

import { IntentState } from '../../../dto/src/enums'

type Ctx = {
  intent: any
  corr_id: string
  request_hash?: string
  cfg: any
}

export async function enrichIntent(ctx: Ctx) {
  const { intent, corr_id, request_hash } = ctx

  // Simple normalization: lowercase addresses if present
  if (intent.payload && intent.payload.to && typeof intent.payload.to === 'string') {
    intent.payload.to = (intent.payload.to as string).toLowerCase()
  }

  // derive fee ceiling (simple heuristic)
  if (!intent.payload.fee_ceiling && intent.payload.gas_limit && ctx.cfg?.feeMultiplier) {
    try {
      const gas = Number(intent.payload.gas_limit)
      intent.payload.fee_ceiling = Math.ceil(gas * (ctx.cfg.feeMultiplier || 1))
    } catch (e) {
      // ignore and proceed
    }
  }

  return { next: IntentState.ENRICHED }
}

export default enrichIntent

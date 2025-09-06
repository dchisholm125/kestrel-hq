/* This file's purpose is to validate the body of a submit-intent request
    A submit intent request is a request to submit a transaction intent to the Kestrel protocol */

import { z } from 'zod'

export const SubmitIntentSchema = z.object({
  intent_id: z.string(),
  target_chain: z.literal('eth-mainnet'),
  target_block: z.number().int().nullable().optional(),
  deadline_ms: z.number().int().min(1),
  max_calldata_bytes: z.number().int().optional(),
  constraints: z
    .object({
      min_net_wei: z.string().optional(),
      max_staleness_ms: z.number().int().optional(),
      revert_shield: z.boolean().optional(),
    })
    .optional(),
  txs: z.array(z.string()).optional(),
  meta: z.object({ strategy_kind: z.string().optional(), notes: z.string().optional() }).optional(),
})

export type SubmitIntent = z.infer<typeof SubmitIntentSchema>

export function validateSubmitIntent(body: unknown) {
  const res = SubmitIntentSchema.safeParse(body)
  if (!res.success) return { valid: false, error: res.error.message }
  return { valid: true, value: res.data as SubmitIntent }
}

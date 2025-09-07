import type { IntentState, ErrorEnvelope } from '@kestrel/dto'

export type SimulationSplit = { bot: bigint; protocol: bigint }
export type SimulationResult = {
  effectiveGasCost: bigint
  bundleFee: bigint
  split: SimulationSplit
  score: number
  ev: number
}

export type SubmitResult =
  | { ok: true; intent_id: string; state: IntentState; simulation?: SimulationResult }
  | { ok: false; error: ErrorEnvelope }

import type { IntentState, ErrorEnvelope } from '@kestrel/dto'

export type SubmitResult =
  | { ok: true; intent_id: string; state: IntentState }
  | { ok: false; error: ErrorEnvelope }

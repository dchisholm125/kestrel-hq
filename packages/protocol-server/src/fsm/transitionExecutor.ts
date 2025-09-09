import { StateMachine } from './stateMachine'
import { IntentState } from '../../../dto/src/enums'
import { db } from '../db/db'
const sm = new StateMachine()

export async function advanceIntent(opts: {
  intentId: string
  to: IntentState | string
  corr_id: string
  request_hash?: string
  reason?: any
}) {
  // For testing without database, just log the transition
  console.log(`[fsm] Transition: ${opts.intentId} -> ${opts.to} (reason: ${opts.reason?.code || 'none'})`);
  return opts.to;
}

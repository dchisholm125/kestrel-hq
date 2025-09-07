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
  return db.tx(async (t: any) => {
    const row = await t.one('SELECT state, version FROM intents WHERE id=$1 FOR UPDATE', [opts.intentId])
    if (!sm.can(row.state, opts.to)) {
      if (row.state === opts.to) return row.state
      throw new Error(`invalid_transition ${row.state}->${opts.to}`)
    }

    await t.none(
      `INSERT INTO intent_events(intent_id, from_state, to_state, reason_code, reason_category, reason_message, context, corr_id, request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        opts.intentId,
        row.state,
        opts.to,
        opts.reason?.code ?? null,
        opts.reason?.category ?? null,
        opts.reason?.message ?? null,
        opts.reason?.context ?? null,
        opts.corr_id,
        opts.request_hash ?? null,
      ]
    )

    const result = await t.result('UPDATE intents SET state=$1, version=version+1 WHERE id=$2 AND version=$3', [opts.to, opts.intentId, row.version])
    if (result.rowCount !== 1) throw new Error('optimistic_lock_failed')
    return opts.to
  })
}

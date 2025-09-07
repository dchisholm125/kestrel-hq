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
    // read current state/version (don't hold FOR UPDATE for optimistic locking pattern)
    const row = await t.one('SELECT state, version FROM intents WHERE id=$1', [opts.intentId])
    if (!sm.can(row.state, opts.to)) {
      if (row.state === opts.to) return row.state
      throw new Error(`invalid_transition ${row.state}->${opts.to}`)
    }

    // record event first (idempotency / audit)
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

    // attempt optimistic update
    const result = await t.result('UPDATE intents SET state=$1, version=version+1 WHERE id=$2 AND version=$3', [opts.to, opts.intentId, row.version])
    if (result.rowCount === 1) return opts.to

    // conflict: refetch current row once to decide whether another transaction already advanced it
    const fresh = await t.one('SELECT state, version FROM intents WHERE id=$1', [opts.intentId])
    if (fresh.state === opts.to) {
      // another transaction already applied this transition — treat as no-op
      return fresh.state
    }

    // otherwise, the attempted transition couldn't be applied due to concurrent update to a different state
    throw new Error(`invalid_transition ${fresh.state}->${opts.to}`)
  })
}

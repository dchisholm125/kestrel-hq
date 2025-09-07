/**
 * admin.ts
 * Database admin helpers for protocol-server.
 * Provides convenience functions used by ops and tests to maintain dashboard materialized views.
 */

import { db } from './db'

export async function refreshIntentLastEvent() {
  // Use CONCURRENTLY to avoid locking reads; requires unique index on MV query results in some Postgres versions
  try {
    await db.tx(async (t: any) => {
      await t.none('REFRESH MATERIALIZED VIEW CONCURRENTLY intent_last_event')
    })
    console.log('intent_last_event refreshed')
  } catch (e) {
    console.error('refreshIntentLastEvent failed', e)
    throw e
  }
}

if (require.main === module) {
  refreshIntentLastEvent().catch(e => { process.exit(1) })
}

/**
 * GET /status/:intent_id handler
 *
 * Returns the current state for an intent and the last rejection reason when
 * available. The HTTP layer keeps responses stable and always returns an
 * ErrorEnvelope when the intent can't be located.
 */
import { Request, Response } from 'express'
import { intentStore } from '../services/IntentStore'
import { ulid } from 'ulid'
import { getReason, ErrorEnvelope, IntentState } from '@kestrel-hq/dto'

export function getStatus(req: Request, res: Response) {
  const id = req.params.intent_id
  const row = intentStore.getById(id)
  if (!row) {
    const reason = getReason('CLIENT_NOT_FOUND')
  const envelope: ErrorEnvelope = { corr_id: `corr_${ulid()}`, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
    return res.status(reason.http_status).json(envelope)
  }

  const lastReason = row.reason_code && row.reason_code !== 'ok' ? (getReason(row.reason_code as any) || null) : null
  return res.status(200).json({ intent_id: row.intent_id, state: row.state, last_reason: lastReason })
}

export default getStatus

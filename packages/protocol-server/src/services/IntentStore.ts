/* The IntentStore is an in-memory store for transaction intents.

   It allows lookup by intent_id and by request_hash (a hash of the canonical JSON of the request body).
   It is used to detect duplicate intents and to retrieve intents by id.
   In a real-world application, this would be backed by a persistent database. */

import crypto from 'crypto'
import { IntentState } from '../../dto/src/enums'

export type IntentRow = {
  intent_id: string
  request_hash: string
  correlation_id: string
  state: IntentState | string
  reason_code: string
  received_at: number
  payload: any
}

class IntentStore {
  private byId: Map<string, IntentRow> = new Map()
  private byHash: Map<string, IntentRow> = new Map()
  // idempotency key -> { row, ts }
  private idempotencyMap: Map<string, { row: IntentRow; ts: number }> = new Map()

  getById(id: string) {
    return this.byId.get(id) ?? null
  }

  getByHash(hash: string) {
    return this.byHash.get(hash) ?? null
  }

  /**
   * Return a row for a hash only if it was created within the provided window (ms).
   */
  getByHashWithin(hash: string, windowMs: number) {
    const row = this.byHash.get(hash)
    if (!row) return null
    if (Date.now() - row.received_at <= windowMs) return row
    return null
  }

  getByIdempotencyKeyWithin(key: string, windowMs: number) {
    const entry = this.idempotencyMap.get(key)
    if (!entry) return null
    if (Date.now() - entry.ts <= windowMs) return entry.row
    // expired — cleanup
    this.idempotencyMap.delete(key)
    return null
  }

  put(row: IntentRow) {
    this.byId.set(row.intent_id, row)
    this.byHash.set(row.request_hash, row)
  }

  setIdempotencyKey(key: string, row: IntentRow) {
    this.idempotencyMap.set(key, { row, ts: Date.now() })
  }

  computeHash(body: unknown) {
    // canonical JSON: stringify with sorted keys
    const canonical = canonicalize(body)
    return crypto.createHash('sha256').update(canonical).digest('hex')
  }
}

function canonicalize(obj: unknown): string {
  if (obj === null) return 'null'
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']'
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize((obj as any)[k])).join(',') + '}'
}

export const intentStore = new IntentStore()

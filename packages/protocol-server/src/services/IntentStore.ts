/* The IntentStore is an in-memory store for transaction intents.

   It allows lookup by intent_id and by request_hash (a hash of the canonical JSON of the request body).
   It is used to detect duplicate intents and to retrieve intents by id.
   In a real-world application, this would be backed by a persistent database. */

import crypto from 'crypto'

export type IntentRow = {
  intent_id: string
  request_hash: string
  correlation_id: string
  state: 'RECEIVED' | string
  reason_code: string
  received_at: number
  payload: any
}

class IntentStore {
  private byId: Map<string, IntentRow> = new Map()
  private byHash: Map<string, IntentRow> = new Map()

  getById(id: string) {
    return this.byId.get(id) ?? null
  }

  getByHash(hash: string) {
    return this.byHash.get(hash) ?? null
  }

  put(row: IntentRow) {
    this.byId.set(row.intent_id, row)
    this.byHash.set(row.request_hash, row)
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

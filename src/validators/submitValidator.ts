export type SubmitTxBody = {
  rawTransaction?: string
  [k: string]: unknown
}

export type ValidationResult =
  | { valid: true; raw: string }
  | { valid: false; error: string }

/**
 * Validate the body submitted to /submit-tx.
 */
export function validateSubmitBody(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'empty or invalid JSON body' }
  }

  const b = body as SubmitTxBody

  const raw = b.rawTransaction
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'rawTransaction field (0x-prefixed hex string) is required (use rawTransaction)' }
  }

  const isHex = /^0x[0-9a-fA-F]+$/.test(raw) && (raw.length - 2) % 2 === 0
  if (!isHex) {
    return { valid: false, error: 'rawTransaction must be a 0x-prefixed hex string with even length' }
  }

  return { valid: true, raw }
}

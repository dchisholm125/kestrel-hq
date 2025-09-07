import { ReasonCode, ReasonCategory, ReasonDetail } from './enums'

// Centralized mapping from ReasonCode -> ReasonDetail (stable code, category, http_status, message)
export const REASONS: Record<ReasonCode, ReasonDetail> = {
  // CLIENT 1xxx
  CLIENT_BAD_REQUEST: { code: 'CLIENT_BAD_REQUEST', category: ReasonCategory.CLIENT, http_status: 400, message: 'Bad request' },
  CLIENT_UNSUPPORTED_FIELD: { code: 'CLIENT_UNSUPPORTED_FIELD', category: ReasonCategory.CLIENT, http_status: 400, message: 'Unsupported field in request' },
  CLIENT_DUPLICATE: { code: 'CLIENT_DUPLICATE', category: ReasonCategory.CLIENT, http_status: 200, message: 'Duplicate request (idempotent)' },
  CLIENT_EXPIRED: { code: 'CLIENT_EXPIRED', category: ReasonCategory.CLIENT, http_status: 400, message: 'Request TTL expired' },

  // SCREEN 2xxx
  SCREEN_TOO_LARGE: { code: 'SCREEN_TOO_LARGE', category: ReasonCategory.SCREEN, http_status: 413, message: 'Request exceeds allowed size' },
  SCREEN_RATE_LIMIT: { code: 'SCREEN_RATE_LIMIT', category: ReasonCategory.SCREEN, http_status: 429, message: 'Rate limit exceeded' },
  SCREEN_REPLAY_SEEN: { code: 'SCREEN_REPLAY_SEEN', category: ReasonCategory.SCREEN, http_status: 200, message: 'Replay detected' },

  // VALIDATION 3xxx
  VALIDATION_SCHEMA_FAIL: { code: 'VALIDATION_SCHEMA_FAIL', category: ReasonCategory.VALIDATION, http_status: 400, message: 'Schema validation failed' },
  VALIDATION_CHAIN_MISMATCH: { code: 'VALIDATION_CHAIN_MISMATCH', category: ReasonCategory.VALIDATION, http_status: 400, message: 'Target chain mismatch' },
  VALIDATION_SIGNATURE_FAIL: { code: 'VALIDATION_SIGNATURE_FAIL', category: ReasonCategory.VALIDATION, http_status: 401, message: 'Signature validation failed' },
  VALIDATION_GAS_BOUNDS: { code: 'VALIDATION_GAS_BOUNDS', category: ReasonCategory.VALIDATION, http_status: 400, message: 'Gas bounds validation failed' },

  // POLICY 4xxx
  POLICY_ACCOUNT_NOT_ALLOWED: { code: 'POLICY_ACCOUNT_NOT_ALLOWED', category: ReasonCategory.POLICY, http_status: 403, message: 'Account not allowed' },
  POLICY_ASSET_NOT_ALLOWED: { code: 'POLICY_ASSET_NOT_ALLOWED', category: ReasonCategory.POLICY, http_status: 403, message: 'Asset not allowed' },
  POLICY_FEE_TOO_LOW: { code: 'POLICY_FEE_TOO_LOW', category: ReasonCategory.POLICY, http_status: 400, message: 'Fee too low' },

  // QUEUE 5xxx
  QUEUE_CAPACITY: { code: 'QUEUE_CAPACITY', category: ReasonCategory.QUEUE, http_status: 503, message: 'Queue capacity exceeded' },
  QUEUE_DEADLINE_TOO_SOON: { code: 'QUEUE_DEADLINE_TOO_SOON', category: ReasonCategory.QUEUE, http_status: 400, message: 'Deadline too soon for queueing' },

  // SUBMIT 6xxx
  SUBMIT_NOT_ATTEMPTED: { code: 'SUBMIT_NOT_ATTEMPTED', category: ReasonCategory.SUBMIT, http_status: 202, message: 'Submission not attempted' },

  // NETWORK 7xxx
  NETWORK_RPC_UNAVAILABLE: { code: 'NETWORK_RPC_UNAVAILABLE', category: ReasonCategory.NETWORK, http_status: 503, message: 'Upstream RPC unavailable' },

  // INTERNAL 9xxx
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', category: ReasonCategory.INTERNAL, http_status: 500, message: 'Internal server error' },
  // NOT FOUND
  CLIENT_NOT_FOUND: { code: 'CLIENT_NOT_FOUND', category: ReasonCategory.CLIENT, http_status: 404, message: 'Not found' },
}

export function getReason(code: ReasonCode): ReasonDetail {
  return REASONS[code]
}

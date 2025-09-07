export enum IntentState {
  RECEIVED = "RECEIVED",
  SCREENED = "SCREENED",
  VALIDATED = "VALIDATED",
  ENRICHED = "ENRICHED",
  QUEUED = "QUEUED",
  SUBMITTED = "SUBMITTED",
  INCLUDED = "INCLUDED",
  DROPPED = "DROPPED",
  REJECTED = "REJECTED",
}

export enum ReasonCategory {
  CLIENT = "CLIENT",
  SCREEN = "SCREEN",
  VALIDATION = "VALIDATION",
  POLICY = "POLICY",
  QUEUE = "QUEUE",
  SUBMIT = "SUBMIT",
  NETWORK = "NETWORK",
  INTERNAL = "INTERNAL",
}

export type ReasonCode =
  | "CLIENT_BAD_REQUEST"
  | "CLIENT_UNSUPPORTED_FIELD"
  | "CLIENT_DUPLICATE"
  | "CLIENT_EXPIRED"
  | "SCREEN_TOO_LARGE"
  | "SCREEN_RATE_LIMIT"
  | "SCREEN_REPLAY_SEEN"
  | "VALIDATION_SCHEMA_FAIL"
  | "VALIDATION_CHAIN_MISMATCH"
  | "VALIDATION_SIGNATURE_FAIL"
  | "VALIDATION_GAS_BOUNDS"
  | "POLICY_ACCOUNT_NOT_ALLOWED"
  | "POLICY_ASSET_NOT_ALLOWED"
  | "POLICY_FEE_TOO_LOW"
  | "QUEUE_CAPACITY"
  | "QUEUE_DEADLINE_TOO_SOON"
  | "SUBMIT_NOT_ATTEMPTED"
  | "NETWORK_RPC_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "CLIENT_NOT_FOUND";

export interface ReasonDetail {
  code: ReasonCode;
  category: ReasonCategory;
  http_status: number;
  message: string;
  context?: Record<string, string | number | boolean>;
}

export interface ErrorEnvelope {
  corr_id: string;
  request_hash?: string;
  state: IntentState;
  reason: ReasonDetail;
  ts: string; // RFC3339 UTC
}

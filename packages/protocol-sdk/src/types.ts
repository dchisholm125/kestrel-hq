export type SubmitIntent = {
  intent_id: string;
  target_chain: 'eth-mainnet';
  target_block?: number | null;
  deadline_ms: number;
  max_calldata_bytes?: number;
  constraints?: {
    min_net_wei?: string;
    max_staleness_ms?: number;
    revert_shield?: boolean;
  };
  txs?: string[];
  meta?: { strategy_kind?: string; notes?: string };
};

export type SubmitResp = {
  intent_id: string;
  decision: 'accepted' | 'queued' | 'rejected' | 'throttled';
  reason_code: string;
  request_hash: string;
  status_url: string;
  correlation_id: string;
};

import { IntentState, ErrorEnvelope } from '@kestrel-hq/dto'

export type StatusResp = {
  intent_id: string;
  state: IntentState | string;
  reason_code: string;
  sim_summary?: {
    gross_profit_wei?: string;
    gas_used?: number;
    basefee_wei?: string;
    tip_wei?: string;
    net_wei?: string;
  } | null;
  bundle_id?: string | null;
  relay_submissions?: any[] | null;
  timestamps_ms: Record<string, number>;
  correlation_id: string;
};

export type ErrorResp = {
  reason_code: string;
  reason_detail: string;
  retryable: boolean;
  suggested_backoff_ms?: number;
};

export type SubmitResult =
  | { ok: true; intent_id: string; state: IntentState }
  | { ok: false; error: ErrorEnvelope };

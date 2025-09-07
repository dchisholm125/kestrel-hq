 ┌─────────────────────────────────────────────────────────────────────┐
 │  RUNG 0: RECEIVED                                                   │
 │  - Request arrives, IDs assigned (corr_id, request_hash).           │
 └─────────────────────────────────────────────────────────────────────┘
                |
                v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  RUNG 1: SCREENED (cheap, constant-time)                            │
 │  Goal: Throw out obvious junk in microseconds.                      │
 │  Examples:                                                          │
 │   - Payload too large → REJECTED (SCREEN_TOO_LARGE)                 │
 │   - TTL in the past → REJECTED (CLIENT_EXPIRED)                     │
 │   - Replay/different body → REJECTED (SCREEN_REPLAY_SEEN)           │
 │   - Rate limit/backoff → REJECTED (SCREEN_RATE_LIMIT)               │
 └─────────────────────────────────────────────────────────────────────┘
                |
                v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  RUNG 2: VALIDATED (moderate)                                       │
 │  Goal: Ensure the intent is coherent and safe to process.           │
 │  Examples:                                                          │
 │   - Schema/shape invalid → REJECTED (VALIDATION_SCHEMA_FAIL)        │
 │   - Chain ID mismatch → REJECTED (VALIDATION_CHAIN_MISMATCH)        │
 │   - Signature check fails → REJECTED (VALIDATION_SIGNATURE_FAIL)    │
 │   - Gas bounds out of policy → REJECTED (VALIDATION_GAS_BOUNDS)     │
 └─────────────────────────────────────────────────────────────────────┘
                |
                v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  RUNG 3: ENRICHED (light, deterministic)                            │
 │  Goal: Normalize and add quick policy context.                      │
 │  Examples:                                                          │
 │   - Normalize addresses / token refs                                │
 │   - Derive fee ceiling / caps                                       │
 │   - Quick policy checks (allowlists, asset guardrails)              │
 │   - Fail fast on policy → REJECTED (POLICY_* codes)                 │
 └─────────────────────────────────────────────────────────────────────┘
                |
                v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  RUNG 4: QUEUED (ready for heavy work)                              │
 │  Goal: Only good intents occupy expensive resources later.          │
 │  Examples:                                                          │
 │   - Backpressure full → REJECTED (QUEUE_CAPACITY)                   │
 │   - Deadline too soon → REJECTED (QUEUE_DEADLINE_TOO_SOON)          │
 │   - Otherwise, stage for submit/sim (future steps).                 │
 └─────────────────────────────────────────────────────────────────────┘

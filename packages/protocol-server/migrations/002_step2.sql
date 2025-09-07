/*
  Migration: 002_step2.sql
  Role: add persistent intent state and optimistic lock, and create an audit table for intent events.

  Rationale: Kestrel requires deterministic, auditable state transitions for intents. Adding a
  `state` column and a `version` column enables optimistic locking in the application layer and
  provides a straightforward source-of-truth for the current state of an intent. The `intent_events`
  table is an append-only audit trail that records every attempted state transition and associated
  metadata (reason, context, correlation ids). This makes post-hoc analysis and replay deterministic.
*/

ALTER TABLE intents
  ADD COLUMN state TEXT NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN version BIGINT NOT NULL DEFAULT 0; -- optimistic lock

/*
  intent_events: append-only audit trail for state transitions.
  We intentionally keep this normalized, indexed by intent_id and timestamp for efficient queries.
*/
CREATE TABLE IF NOT EXISTS intent_events (
  id BIGSERIAL PRIMARY KEY,
  intent_id UUID NOT NULL REFERENCES intents(id),
  from_state TEXT,
  to_state   TEXT,
  reason_code TEXT,
  reason_category TEXT,
  reason_message TEXT,
  context JSONB,
  corr_id TEXT,
  request_hash TEXT,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intent_events_intent_ts_idx ON intent_events (intent_id, ts);

/*
  Materialized view: intent_last_event
  ------------------------------------------------------
  Conceptual note:
  The purpose of the `intent_last_event` materialized view is to provide a fast, read-optimized
  snapshot of the most recent event per intent for dashboarding and analytics. We intentionally
  maintain this as a materialized view (refreshed asynchronously) because:
    - Dashboards can tolerate eventual consistency and benefit greatly from fast aggregate reads.
    - Transactional reads and write paths should continue to use the authoritative `intents` and
      `intent_events` tables to avoid coupling to asynchronous refresh cycles.
  We snapshot only the last event per intent (DISTINCT ON) ordered by timestamp descending.
*/

CREATE MATERIALIZED VIEW IF NOT EXISTS intent_last_event AS
  SELECT DISTINCT ON (intent_id) intent_id, id AS event_id, from_state, to_state, reason_code, reason_category, reason_message, context, corr_id, request_hash, ts
  FROM intent_events
  ORDER BY intent_id, ts DESC;

-- Backfill legacy rows to ensure explicit defaults for older rows created before this migration.
UPDATE intents SET state='RECEIVED' WHERE state IS NULL;
UPDATE intents SET version=0 WHERE version IS NULL;


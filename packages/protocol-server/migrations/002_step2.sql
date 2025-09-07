-- migration 002_step2.sql
ALTER TABLE intents
  ADD COLUMN state TEXT NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN version BIGINT NOT NULL DEFAULT 0;           -- optimistic lock

CREATE TABLE intent_events (
  id BIGSERIAL PRIMARY KEY,
  intent_id UUID NOT NULL REFERENCES intents(id),
  from_state TEXT NOT NULL,
  to_state   TEXT NOT NULL,
  reason_code TEXT,
  reason_category TEXT,
  reason_message TEXT,
  context JSONB,
  corr_id TEXT NOT NULL,
  request_hash TEXT,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON intent_events (intent_id, ts);

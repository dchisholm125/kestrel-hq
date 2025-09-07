/**
 * make-fixtures.ts
 * Purpose: Generate deterministic JSONL fixtures for demoing and regression repros across machines/CI.
 * Each fixture captures an intent's state transitions as discrete, immutable JSON objects—ready to stream, diff, and reload.
 */

import fs from 'fs'
import path from 'path'

type EventRow = {
  intent_id: string
  from_state: string | null
  to_state: string
  reason_code?: string | null
  reason_category?: string | null
  reason_message?: string | null
  context?: Record<string, unknown> | null
  corr_id?: string | null
  request_hash?: string | null
  ts: string
}

// Deterministic base time
const BASE_TS = new Date('2025-01-01T00:00:00.000Z').getTime()

// Deterministic intent IDs (valid UUIDv4 with variant nibble)
const IDS = {
  green: '11111111-1111-4111-8111-111111111111',
  policy: '22222222-2222-4222-8222-222222222222',
  replay: '33333333-3333-4333-8333-333333333333',
}

// Deterministic corr_ids
const CORR = {
  green: 'e2e-green-1',
  policy: 'e2e-policy-1',
  replay: 'e2e-replay-1',
}

function t(n: number) {
  return new Date(BASE_TS + n).toISOString()
}

/**
 * JSONL rationale:
 * - Append-friendly for long-running sessions
 * - Streamable for CLI tools
 * - Diff-able in VCS
 * - Each line is a complete, immutable event object
 */
function writeJsonl(file: string, rows: EventRow[]) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const fd = fs.openSync(file, 'w')
  try {
    for (const r of rows) {
      fs.writeSync(fd, JSON.stringify(r) + '\n')
    }
  } finally {
    fs.closeSync(fd)
  }
}

function greenFixture(): { name: string; rows: EventRow[]; intent_id: string; corr_id: string } {
  const intent_id = IDS.green
  const corr_id = CORR.green
  const rows: EventRow[] = [
    { intent_id, from_state: null, to_state: 'RECEIVED', corr_id, ts: t(0) },
    { intent_id, from_state: 'RECEIVED', to_state: 'SCREENED', corr_id, ts: t(100) },
    { intent_id, from_state: 'SCREENED', to_state: 'VALIDATED', corr_id, ts: t(200) },
    { intent_id, from_state: 'VALIDATED', to_state: 'ENRICHED', corr_id, ts: t(300) },
    { intent_id, from_state: 'ENRICHED', to_state: 'QUEUED', corr_id, ts: t(400) },
  ]
  return { name: 'green.jsonl', rows, intent_id, corr_id }
}

function policyRejectFixture(): { name: string; rows: EventRow[]; intent_id: string; corr_id: string } {
  const intent_id = IDS.policy
  const corr_id = CORR.policy
  const rows: EventRow[] = [
    { intent_id, from_state: null, to_state: 'RECEIVED', corr_id, ts: t(0) },
    { intent_id, from_state: 'RECEIVED', to_state: 'SCREENED', corr_id, ts: t(100) },
    { intent_id, from_state: 'SCREENED', to_state: 'VALIDATED', corr_id, ts: t(200) },
    { intent_id, from_state: 'VALIDATED', to_state: 'ENRICHED', corr_id, ts: t(300) },
    {
      intent_id,
      from_state: 'ENRICHED',
      to_state: 'REJECTED',
      corr_id,
      reason_code: 'POLICY_FEE_TOO_LOW',
      reason_category: 'POLICY',
      reason_message: 'Rejecting at POLICY: fee too low',
      context: {},
      ts: t(400),
    },
  ]
  return { name: 'policy_reject.jsonl', rows, intent_id, corr_id }
}

function replayRejectFixture(): { name: string; rows: EventRow[]; intent_id: string; corr_id: string } {
  const intent_id = IDS.replay
  const corr_id = CORR.replay
  const rows: EventRow[] = [
    { intent_id, from_state: null, to_state: 'RECEIVED', corr_id, ts: t(0) },
    {
      intent_id,
      from_state: 'RECEIVED',
      to_state: 'REJECTED',
      corr_id,
      reason_code: 'SCREEN_REPLAY_SEEN',
      reason_category: 'SCREEN',
      reason_message: 'Rejecting at SCREEN: replay seen',
      context: {},
      ts: t(100),
    },
  ]
  return { name: 'replay.jsonl', rows, intent_id, corr_id }
}

function main() {
  // Start
  // eslint-disable-next-line no-console
  console.info('[fixtures] generating deterministic JSONL fixtures…')

  const outDir = path.resolve(__dirname, '..', 'fixtures')

  const fixtures = [greenFixture(), policyRejectFixture(), replayRejectFixture()]

  for (const f of fixtures) {
    const file = path.join(outDir, f.name)
    writeJsonl(file, f.rows)
  // eslint-disable-next-line no-console
  console.info(`${path.basename(f.name, '.jsonl')}: ${f.rows.length} events written (intent ${f.corr_id})`)
  }

  // Manifest for reproducibility and audit
  const manifest = {
    ts: new Date().toISOString(),
    generator_version: require('../package.json').version || 'dev',
    files: fixtures.map(f => ({ name: f.name, count: f.rows.length, intent_id_range: [f.intent_id, f.intent_id] })),
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  // eslint-disable-next-line no-console
  console.info('[fixtures] done')
}

if (require.main === module) {
  try { main() } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[fixtures] generation failed', e)
    process.exit(1)
  }
}

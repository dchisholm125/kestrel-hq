/**
 * load-fixtures.ts
 * Purpose: Load deterministic JSONL fixture events back into a demo DB for instant repros and demos.
 * JSONL enables append-friendly, streamable, diff-able records where each line is a complete, immutable event.
 */

import fs from 'fs'
import path from 'path'
// Dynamic require to avoid strict type dependency; matches approach used in src/db/db.ts
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { Client }: any = (() => { try { return require('pg') } catch { return { Client: class {} } } })()

type EventRow = {
  intent_id: string
  from_state?: string | null
  to_state: string
  reason_code?: string | null
  reason_category?: string | null
  reason_message?: string | null
  context?: Record<string, unknown> | null
  corr_id?: string | null
  request_hash?: string | null
  ts: string
}

function parseJsonl(file: string): EventRow[] {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const out: EventRow[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      out.push(obj)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[fixtures] malformed JSON on ${path.basename(file)}:${i + 1} — skipping`)
    }
  }
  return out
}

async function loadIntoDb(rows: EventRow[]) {
  const cn = process.env.DATABASE_URL || 'postgres://localhost/kestrel'
  const client = new Client({ connectionString: cn })
  await client.connect()
  try {
    await client.query('BEGIN')
    for (const r of rows) {
      await client.query(
        `INSERT INTO intent_events(intent_id, from_state, to_state, reason_code, reason_category, reason_message, context, corr_id, request_hash, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [r.intent_id, r.from_state ?? null, r.to_state, r.reason_code ?? null, r.reason_category ?? null, r.reason_message ?? null, r.context ?? null, r.corr_id ?? null, r.request_hash ?? null, r.ts]
      )
    }
    await client.query('COMMIT')
  } catch (e: any) {
    await client.query('ROLLBACK')
    // eslint-disable-next-line no-console
    console.error('[fixtures] load failed, rolled back', e?.message || e)
    throw e
  } finally {
    await client.end()
  }
}

function sanityChecks(rows: EventRow[], name: string) {
  // Ensure chronological order and no duplicates (same intent_id + ts)
  let ok = true
  const seen = new Set<string>()
  let lastTs = 0
  for (const r of rows) {
    const key = `${r.intent_id}:${r.ts}`
    if (seen.has(key)) {
      console.warn(`[fixtures] duplicate row in ${name}: ${key}`)
      ok = false
    }
    seen.add(key)
    const cur = Date.parse(r.ts)
    if (cur < lastTs) {
      console.warn(`[fixtures] out-of-order ts in ${name}: ${r.ts}`)
      ok = false
    }
    lastTs = cur
  }
  return ok
}

async function main() {
  // Start
  // eslint-disable-next-line no-console
  console.info('[fixtures] loading JSONL fixtures into DB…')
  const dir = path.resolve(__dirname, '..', 'fixtures')
  const files = ['green.jsonl', 'policy_reject.jsonl', 'replay.jsonl']
  let total = 0
  for (const f of files) {
    const file = path.join(dir, f)
    const rows = parseJsonl(file)
    if (!sanityChecks(rows, f)) {
      // eslint-disable-next-line no-console
      console.warn(`[fixtures] sanity checks failed for ${f} — continuing`) 
    }
    await loadIntoDb(rows)
    total += rows.length
    // eslint-disable-next-line no-console
    console.info(`[fixtures] ${f}: loaded ${rows.length} rows`)
  }
  // eslint-disable-next-line no-console
  console.info(`[fixtures] done — ${total} rows loaded across ${files.length} files`)
}

if (require.main === module) {
  main().catch(e => { process.exit(1) })
}

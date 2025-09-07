import { Client } from 'pg'
import fs from 'fs'
import path from 'path'

// This integration test runs only when TEST_DB is set (a Postgres connection string)
const TEST_DB = process.env.TEST_DB
if (!TEST_DB) {
  console.warn('Skipping DB integration tests: TEST_DB not set')
}

describe('migrations integration (requires TEST_DB)', () => {
  let client: Client
  beforeAll(async () => {
    if (!TEST_DB) return
    client = new Client({ connectionString: TEST_DB })
    await client.connect()
    // apply migrations via script
    const migrate = require(path.join(__dirname, '..', '..', 'scripts', 'dbMigrate.ts'))
    // dbMigrate runs psql externally; ensure it can reach TEST_DB via env
    process.env.DATABASE_URL = TEST_DB
    await new Promise((res, rej) => {
      const spawn = require('child_process').spawn
      const proc = spawn('ts-node', [path.join(__dirname, '..', '..', 'scripts', 'dbMigrate.ts')], { stdio: 'inherit' })
      proc.on('exit', (code: number) => code === 0 ? res(null) : rej(new Error('migrate failed ' + code)))
    })
  }, 60000)

  afterAll(async () => {
    if (client) await client.end()
  })

  test('migration-shape: intents have state and version; intent_events exists', async () => {
    if (!TEST_DB) return
    const r1 = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='intents' and column_name IN ('state','version')")
    const cols = r1.rows.map((r: any) => r.column_name)
    expect(cols).toEqual(expect.arrayContaining(['state','version']))
    const r2 = await client.query("SELECT to_regclass('public.intent_events') AS exists")
    expect(r2.rows[0].exists).not.toBeNull()
  })

  test('backfill-defaults: existing intents have defaults', async () => {
    if (!TEST_DB) return
    // insert a legacy row without state/version
    const id = '00000000-0000-0000-0000-000000000001'
    await client.query("INSERT INTO intents(id) VALUES ($1) ON CONFLICT DO NOTHING", [id])
    const r = await client.query("SELECT state, version FROM intents WHERE id=$1", [id])
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].state).toBe('RECEIVED')
    expect(Number(r.rows[0].version)).toBeGreaterThanOrEqual(0)
  })

  test('mv-freshness: insert events, refresh mv, and check last event', async () => {
    if (!TEST_DB) return
    const id = '00000000-0000-0000-0000-000000000002'
    await client.query("INSERT INTO intents(id) VALUES ($1) ON CONFLICT DO NOTHING", [id])
    await client.query("INSERT INTO intent_events(intent_id, from_state, to_state, corr_id, ts) VALUES ($1,'RECEIVED','SCREENED','c1',now()-interval '2 seconds')", [id])
    await client.query("INSERT INTO intent_events(intent_id, from_state, to_state, corr_id, ts) VALUES ($1,'SCREENED','VALIDATED','c2',now()-interval '1 seconds')", [id])
    await client.query("INSERT INTO intent_events(intent_id, from_state, to_state, corr_id, ts) VALUES ($1,'VALIDATED','QUEUED','c3',now())", [id])
    // refresh materialized view
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY intent_last_event')
    const r = await client.query("SELECT * FROM intent_last_event WHERE intent_id=$1", [id])
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].to_state).toBe('QUEUED')
  })
})

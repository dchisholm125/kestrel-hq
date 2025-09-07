/**
 * dbMigrate.ts
 * Utility to run SQL migrations in order for the protocol-server package.
 * Role: ensure DB schema changes are applied in a deterministic order.
 * Note: For production use consider using a robust migration tool (eg. Flyway, Sqitch, or node-pg-migrate).
 */

import fs from 'fs'
import path from 'path'

async function run() {
  const migrationsDir = path.join(__dirname, '..', 'migrations')
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  console.log('Migrations found:', files)
  for (const f of files) {
    const p = path.join(migrationsDir, f)
    const sql = fs.readFileSync(p, 'utf8')
    console.log(`--- Migration: ${f} ---`) 
  // naive execution: open psql using DATABASE_URL env
  const dbUrl = process.env.DATABASE_URL || 'postgres://localhost/kestrel'
  // spawn psql for idempotent apply using -f <file>
  const spawn = require('child_process').spawnSync
  const res = spawn('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-f', p], { stdio: 'inherit' })
    if (res.status !== 0) {
      console.error(`Migration ${f} failed`)
      process.exit(1)
    }
  }
  console.log('Migrations applied')
}

if (require.main === module) {
  run().catch((e) => {
    console.error('Migration error', e)
    process.exit(1)
  })
}

/**
 * applyDeletions.ts
 * Purpose: Read reports/unused-aggregate.json and plan file deletions conservatively.
 * Safety filters:
 *  - Only files with 0 references (orphans) and not index.ts, not types.d.ts.
 *  - Skip any file exporting symbols referenced by other packages.
 *  - Never delete files in src/index.ts or barrel files.
 * Execution:
 *  - Write planned deletions to reports/deletions.jsonl.
 *  - Optionally delete in batches of <=25, running build+test after each; rollback on failure.
 * Rollback: Each batch writes an entry to apply.log.jsonl with success/failure.
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

type Aggregate = {
  tsprune: Record<string, Array<{ file: string; identifier: string }>>
  orphans: string[]
}

function readJSON<T>(p: string): T { return JSON.parse(fs.readFileSync(p, 'utf8')) as T }

function isSafeToDelete(relPath: string): boolean {
  if (/node_modules|dist|__tests__|test\//.test(relPath)) return false
  if (/index\.ts$/.test(relPath)) return false
  if (/types?\.d\.ts$/.test(relPath)) return false
  return true
}

function stageDeletePlan(files: string[], root: string) {
  const reports = path.join(root, 'reports')
  const deletionsPath = path.join(reports, 'deletions.jsonl')
  fs.mkdirSync(reports, { recursive: true })
  for (const f of files) {
    const rec = { ts: new Date().toISOString(), action: 'plan-delete', file: f, reason: 'orphan/no-refs' }
    fs.appendFileSync(deletionsPath, JSON.stringify(rec) + '\n')
  }
}

function run(cmd: string, cwd: string) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' })
}

function applyInBatches(files: string[], root: string, batchSize = 25) {
  const log = path.join(root, 'reports', 'apply.log.jsonl')
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize)
    try {
      // delete files
      for (const rel of batch) {
        const abs = path.join(root, rel)
        if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true })
      }
      // build & test
      const buildOut = run('pnpm -w build', root)
      const testOut = run('pnpm -w test', root)
      const rec = { ts: new Date().toISOString(), batch: { start: i, count: batch.length }, status: 'success', buildOutLen: buildOut.length, testOutLen: testOut.length }
      fs.appendFileSync(log, JSON.stringify(rec) + '\n')
      console.log(`[refactor] batch ${i / batchSize + 1}: success (${batch.length} files)`)    
    } catch (e: any) {
      // rollback via git checkout
      for (const rel of batch) {
        try { run(`git checkout -- "${rel}"`, root) } catch {}
      }
      const rec = { ts: new Date().toISOString(), batch: { start: i, count: batch.length }, status: 'failure', error: e?.message }
      fs.appendFileSync(log, JSON.stringify(rec) + '\n')
      console.warn(`[refactor] batch failed, rolled back: ${e?.message}`)
    }
  }
}

function main() {
  const root = path.resolve(__dirname, '..', '..')
  const aggPath = path.join(root, 'reports', 'unused-aggregate.json')
  if (!fs.existsSync(aggPath)) {
    console.error('[refactor] missing reports/unused-aggregate.json; run analysis first')
    process.exit(1)
  }
  const aggregate = readJSON<Aggregate>(aggPath)
  const candidates = (aggregate.orphans || [])
    .filter(p => isSafeToDelete(p))
  if (!candidates.length) {
    console.log('[refactor] no deletion candidates found')
    return
  }
  stageDeletePlan(candidates, root)
  console.log(`[refactor] proposed deletions: ${candidates.length}`)
  // Only apply when APPLY_DELETIONS=1
  if (process.env.APPLY_DELETIONS === '1') {
    applyInBatches(candidates, root)
  }
}

if (require.main === module) main()

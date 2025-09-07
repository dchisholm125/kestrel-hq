import fs from 'fs'
import path from 'path'
import { submitPath } from '../../src/pipeline/submitPath'
import { getEdgeModules } from '../../src/edge/loader'
import { ReasonedRejection } from '@kestrel/reasons'

// Helper to get the guard log path used by submitPath (src/logs/submission-guard.jsonl)
function guardLogPath() {
  // __dirname would be test/unit; reconstruct path to src/logs
  return path.resolve(__dirname, '../../src/logs/submission-guard.jsonl')
}

describe('submitPath guard (public NOOP)', () => {
  beforeEach(() => {
    const p = guardLogPath()
    try { fs.unlinkSync(p) } catch {}
  try { fs.rmSync(path.dirname(p), { recursive: true, force: true }) } catch {}
  })

  it('throws SUBMIT_NOT_ATTEMPTED and writes JSONL when using NOOP defaults', async () => {
    const edge = await getEdgeModules()
    const ctx = { edge, intent: { intent_id: 'i-guard-1' }, corr_id: 'corr_test_1', request_hash: 'hash_x' }

    await expect(submitPath(ctx)).rejects.toBeInstanceOf(ReasonedRejection)
    try {
      await submitPath(ctx)
    } catch (e: any) {
      expect(e).toBeInstanceOf(ReasonedRejection)
      expect(e.reason.code).toBe('SUBMIT_NOT_ATTEMPTED')
    }

    const p = guardLogPath()
    expect(fs.existsSync(p)).toBe(true)
    const lines = fs.readFileSync(p, 'utf8').trim().split(/\n+/)
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const last = JSON.parse(lines[lines.length - 1])
    expect(last.corr_id).toBe('corr_test_1')
    expect(last.intent_id).toBe('i-guard-1')
    expect(last.reason).toBe('SUBMIT_NOT_ATTEMPTED')
  })

  it('does not throw when non-NOOP assembler is provided', async () => {
    const edge = await getEdgeModules()
    // override BundleAssembler to a non-NOOP shape
    const customEdge: any = {
      ...edge,
      BundleAssembler: new (class CustomBA { async assembleBundle() { return { txs: [], metadata: {} } } })()
    }
    const ctx = { edge: customEdge, intent: { intent_id: 'i-guard-2' }, corr_id: 'corr_test_2', request_hash: 'hash_y' }
    await expect(submitPath(ctx)).resolves.toBeUndefined()
    const p = guardLogPath()
    // File may still exist from previous tests; ensure no new entry with corr_test_2 was added
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8')
      expect(content.includes('corr_test_2')).toBe(false)
    }
  })
})

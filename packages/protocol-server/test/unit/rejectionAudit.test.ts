import * as fs from 'fs'
import path from 'path'
import { appendRejection } from '../../src/utils/rejectionAudit'

describe('rejection audit log', () => {
  test('writes one JSONL line', async () => {
    const baseDir = path.join(process.cwd(), 'packages', 'protocol-server', 'logs')
    const file = path.join(baseDir, 'rejections.jsonl')
    try { await fs.promises.rm(file, { force: true }) } catch {}
    await appendRejection({
      ts: new Date().toISOString(),
      corr_id: 'corr_x',
      intent_id: 'i1',
      stage: 'validate',
      reason: { code: 'CLIENT_BAD_REQUEST', category: 'CLIENT', http_status: 400, message: 'x' },
      context: { a: 1 }
    })
    const data = await fs.promises.readFile(file, 'utf8')
    const lines = data.trim().split('\n')
    expect(lines.length).toBe(1)
    const obj = JSON.parse(lines[0])
    expect(obj.corr_id).toBe('corr_x')
    expect(obj.intent_id).toBe('i1')
    expect(obj.stage).toBe('validate')
    expect(obj.reason.code).toBe('CLIENT_BAD_REQUEST')
  })
})

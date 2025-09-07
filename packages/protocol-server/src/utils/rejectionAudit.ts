import { promises as fs } from 'fs'
import path from 'path'

/**
 * rejectionAudit
 * Appends a single JSONL record for a ReasonedRejection emitted by a stage.
 * File: packages/protocol-server/logs/rejections.jsonl (relative to repo root at runtime when possible).
 */
export async function appendRejection(entry: {
  ts: string
  corr_id: string
  intent_id: string
  stage: string
  reason: { code: string; category: string; http_status: number; message: string }
  context?: Record<string, unknown>
}) {
  try {
    const baseDir = path.join(process.cwd(), 'packages', 'protocol-server', 'logs')
    await fs.mkdir(baseDir, { recursive: true })
    const file = path.join(baseDir, 'rejections.jsonl')
    await fs.appendFile(file, JSON.stringify(entry) + '\n')
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[rejectionAudit] write failed', e)
  }
}

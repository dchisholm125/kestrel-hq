/**
 * submitPath.ts
 * Public-build guard for the post-QUEUED submission path. This routes through the edge seam.
 * In public builds (NOOP defaults active), we never submit; instead we produce a SUBMIT_NOT_ATTEMPTED
 * ReasonedRejection for observability while keeping state at QUEUED (Step 2 discipline: no side effects).
 * Private builds will bypass this guard (returning without error) and handle submission elsewhere.
 */

import fs from 'fs'
import path from 'path'
import type { EdgeModules } from '../edge/loader'
import { reason, ReasonedRejection } from '@kestrel-hq/reasons'

export type SubmitCtx = {
  edge: EdgeModules
  intent: { intent_id: string }
  corr_id: string
  request_hash: string
}

/**
 * Guard: if BundleAssembler is the NOOP default, do not submit. This keeps public builds safe and deterministic.
 * Rationale: Public distributions must not attempt real relay submissions; they should remain side-effect-free.
 */
export async function submitPath(ctx: SubmitCtx): Promise<void> {
  const { edge, intent, corr_id } = ctx
  const assembler = edge.BundleAssembler as any
  const isNoop = assembler?.constructor?.name === 'NoopBundleAssembler' || assembler?.__noop === true
  if (isNoop) {
    try { console.warn('Submission disabled in public build; returning SUBMIT_NOT_ATTEMPTED') } catch {}
    // persistent guard audit
    try {
      const dir = path.resolve(__dirname, '..', 'logs')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'submission-guard.jsonl')
      const rec = { ts: new Date().toISOString(), corr_id, intent_id: intent.intent_id, guard: 'public-noop', reason: 'SUBMIT_NOT_ATTEMPTED' }
      fs.appendFileSync(file, JSON.stringify(rec) + '\n')
    } catch {}
    // Throw a ReasonedRejection that callers can handle without advancing state beyond QUEUED.
    throw new ReasonedRejection(reason('SUBMIT_NOT_ATTEMPTED'))
  }
  // Private implementations: do nothing here; actual submission occurs in private track.
}

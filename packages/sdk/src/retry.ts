/**
 * Retry Policy (SDK)
 * Encodes a conservative, deterministic retry policy that bot clients can adopt by default.
 * Stability: The policy aims to be stable across versions; deploy-specific overrides can be layered on top.
 */
import type { ReasonCode } from '@kestrel-hq/dto'

/**
 * shouldRetry
 * Rationale:
 * - Retry for transient conditions: QUEUE_* (backpressure), NETWORK_* (provider hiccups).
 * - Do NOT auto-retry CLIENT_*, VALIDATION_*, POLICY_* (caller must change the request).
 * - INTERNAL_ERROR is not auto-retried by default to prevent thundering herds on server faults.
 */
export function shouldRetry(code: ReasonCode): boolean {
  if (code.startsWith('QUEUE_')) return true
  if (code.startsWith('NETWORK_')) return true
  if (code.startsWith('CLIENT_')) return false
  if (code.startsWith('VALIDATION_')) return false
  if (code.startsWith('POLICY_')) return false
  if (code === 'INTERNAL_ERROR') return false
  // Default safe choice
  return false
}

export function retryDelay(code: ReasonCode, attempt: number, base = 100, cap = 2000): number {
  // exponential backoff with jitter
  const exp = Math.min(base * Math.pow(2, Math.max(0, attempt)), cap)
  const jitter = Math.floor(Math.random() * 50)
  return Math.min(exp + jitter, cap)
}

export interface AuditWriter {
  write(line: string): Promise<void>
}

export type SubmitErrorInfo = {
  ts: string
  intent_id?: string
  attempt: number
  outcome: 'ok' | 'error'
  reason_code?: ReasonCode
  next_retry_ms?: number
}

/**
 * Logs one-liners and optional client-side audit JSONL for submit errors.
 */
export async function logSubmitOutcome(opts: {
  ok: boolean
  code?: ReasonCode
  intent_id?: string
  attempt: number
  auditWriter?: AuditWriter
  nextRetryMs?: number
}) {
  if (!opts.ok) {
    const willRetry = opts.code ? shouldRetry(opts.code) : false
    const delayPart = willRetry ? ` (retry in ${opts.nextRetryMs ?? 0}ms)` : ' (no retry)'
    try {
      // eslint-disable-next-line no-console
      console.info(`submit failed: ${opts.code ?? 'UNKNOWN'}${delayPart}`)
    } catch {}

    const writer = opts.auditWriter ?? getDefaultClientAuditWriter()
    if (writer) {
      const rec: SubmitErrorInfo = {
        ts: new Date().toISOString(),
        intent_id: opts.intent_id,
        attempt: opts.attempt,
        outcome: 'error',
        reason_code: opts.code,
        next_retry_ms: willRetry ? (opts.nextRetryMs ?? 0) : undefined,
      }
      try { await writer.write(JSON.stringify(rec) + '\n') } catch {}
    }
  } else if (opts.auditWriter) {
    const rec: SubmitErrorInfo = {
      ts: new Date().toISOString(),
      intent_id: opts.intent_id,
      attempt: opts.attempt,
      outcome: 'ok',
    }
    try { await opts.auditWriter.write(JSON.stringify(rec) + '\n') } catch {}
  }
}

/**
 * SDK hooks exposing simulation results to bots.
 * Why allow local sim: fast heuristics during strategy development; server sim remains authoritative in pipelines.
 */
export type LocalSimInputs = {
  profit: bigint
  gasCost: bigint
  latencyMs: number
  risk: number
  outcomes: Array<{ p: number; v: number }>
}

export async function simulateLocally(inputs: LocalSimInputs) {
  // Use math modules client-side; no I/O or persistence.
  const { calcBundleFee, rebateSplit, combineScores, scoreByLatency, scoreByProfit, scoreByRisk, expectedValue, normalizeProbs } = await import('@kestrel-hq/math')
  const effectiveGasCost = inputs.gasCost < 0n ? 0n : inputs.gasCost
  const bundleFee = calcBundleFee(inputs.profit, effectiveGasCost)
  const split = rebateSplit(inputs.profit, bundleFee)
  const score = combineScores([0.5, 0.3, 0.2], [
    scoreByProfit(inputs.profit),
    scoreByLatency(inputs.latencyMs),
    scoreByRisk(inputs.risk),
  ])
  const probs = normalizeProbs(inputs.outcomes.map(o => o.p))
  const ev = expectedValue(probs, inputs.outcomes.map(o => o.v))
  try { console.info(`[sdk] local sim score=${score.toFixed(4)}`) } catch {}
  return { effectiveGasCost, bundleFee, split, score, ev }
}

// Optional default audit writer factory: appends JSONL to ~/.kestrel/audit/client_submissions.jsonl
// Non-fatal if FS is unavailable (browser) – returns undefined.
export function getDefaultClientAuditWriter(): AuditWriter | undefined {
  try {
    return {
      write: async (line: string) => {
        try {
          const os = await import('os')
          const path = await import('path')
          const fs = await import('fs/promises')
          const home = os.homedir?.()
          if (!home) return
          const dir = path.join(home, '.kestrel', 'audit')
          const file = path.join(dir, 'client_submissions.jsonl')
          try { await fs.mkdir(dir, { recursive: true }) } catch {}
          try { await fs.appendFile(file, line) } catch {}
        } catch {
          // ignore
        }
      },
    }
  } catch {
    return undefined
  }
}

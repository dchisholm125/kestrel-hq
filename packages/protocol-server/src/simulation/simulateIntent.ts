/**
 * simulateIntent.ts
 * Simulation stub combining math modules; no I/O in core logic. Side-effect wrapper logs to console and appends JSONL.
 * Why keep math separate: testability + microsecond speed; orchestration can inject inputs and handle persistence.
 */

import fs from 'fs'
import path from 'path'
import { calcBundleFee, rebateSplit } from '@kestrel-hq/math'
import { combineScores, scoreByLatency, scoreByProfit, scoreByRisk } from '@kestrel-hq/math'
import { expectedValue, normalizeProbs } from '@kestrel-hq/math'

export type SimInputs = {
  profit: bigint
  gasCost: bigint
  latencyMs: number
  risk: number // 0..1
  outcomes: Array<{ p: number; v: number }>
}

export type SimOutputs = {
  effectiveGasCost: bigint
  bundleFee: bigint
  split: { bot: bigint; protocol: bigint }
  score: number
  ev: number
}

export function simulateIntentCore(input: SimInputs): SimOutputs {
  const effectiveGasCost = input.gasCost < 0n ? 0n : input.gasCost
  const bundleFee = calcBundleFee(input.profit, effectiveGasCost)
  const split = rebateSplit(input.profit, bundleFee)

  const sProfit = scoreByProfit(input.profit)
  const sLatency = scoreByLatency(input.latencyMs)
  const sRisk = scoreByRisk(input.risk)
  const score = combineScores([0.5, 0.3, 0.2], [sProfit, sLatency, sRisk])

  // Normalize outcome probabilities before EV to be tolerant of unnormalized inputs
  const probs = normalizeProbs(input.outcomes.map(o => o.p))
  const ev = expectedValue(probs, input.outcomes.map(o => o.v))

  return { effectiveGasCost, bundleFee, split, score, ev }
}

export function simulateAndRecord(opts: SimInputs & { corr_id?: string; intent_id?: string }) {
  const outputs = simulateIntentCore(opts)
  try {
    // eslint-disable-next-line no-console
    console.info(`Simulated intent: profit=${opts.profit} fee=${outputs.bundleFee} score=${outputs.score.toFixed(4)}`)
  } catch {}
  try {
    const dir = path.resolve(__dirname, '..', '..', 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'simulations.jsonl')
    const rec = {
      ts: new Date().toISOString(),
      corr_id: opts.corr_id,
      intent_id: opts.intent_id,
      inputs: { profit: String(opts.profit), gasCost: String(opts.gasCost), latencyMs: opts.latencyMs, risk: opts.risk, outcomes: opts.outcomes },
      outputs: { effectiveGasCost: String(outputs.effectiveGasCost), bundleFee: String(outputs.bundleFee), split: { bot: String(outputs.split.bot), protocol: String(outputs.split.protocol) }, score: outputs.score, ev: outputs.ev },
    }
    fs.appendFileSync(file, JSON.stringify(rec) + '\n')
  } catch {}
  return outputs
}

export default simulateIntentCore

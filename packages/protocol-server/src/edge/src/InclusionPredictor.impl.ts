/**
 * InclusionPredictorImpl
 * Heuristic predictor for bundle inclusion and latency.
 * NOTE: This is a v0 logistic-style model for quick signal; calibrate with EWMA.
 */

import { promises as fs } from 'node:fs';

type TxTemplate = { kind: string };
type GasPolicy = { priorityFee: number };
type ReplacementPolicy = { maxBumps: number; bumpStep: number; bumpCap: number };
type BundlePlan = {
  txTemplates: TxTemplate[];
  gasPolicy: GasPolicy;
  replacementPolicy: ReplacementPolicy;
  deadline: number;
  atomic: boolean;
};

export type LaneHealth = {
  id: string;
  healthy: boolean;
  authenticated: boolean;
  rttMs?: number;
  incRate?: number; // EWMA inclusion rate from calibrator [0,1]
};

export type InclusionPrediction = {
  pInclusion: number;
  pLatencyMs: number;
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function gweiFromWei(wei: number): number {
  return wei / 1e9;
}

export class InclusionPredictorImpl {
  /**
   * predict(): Returns a simple inclusion probability and expected latency.
   * Features: lane inclusion rate (EWMA), tip size (gwei), bundle size, time to deadline.
   */
  predict(plan: BundlePlan, laneStats: LaneHealth[]): InclusionPrediction {
    const now = Date.now();
    const timeToDeadlineSec = Math.max(0, (plan.deadline - now) / 1000);
    const size = plan.txTemplates.length || 1;
    const tipGwei = Math.max(0.1, gweiFromWei(plan.gasPolicy.priorityFee || 0));

    const healthy = laneStats.filter(l => l.healthy);
    const incRates = (healthy.length ? healthy : laneStats).map(l => l.incRate ?? 0.5);
    const rtts = (healthy.length ? healthy : laneStats).map(l => l.rttMs ?? 250);
    const meanInc = incRates.length ? incRates.reduce((a, b) => a + b, 0) / incRates.length : 0.5;
    const meanRtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 300;

    // Logistic-style model
    const a0 = -0.5; // bias
    const aInc = 2.2; // weight for inclusion rate (log domain)
    const aTip = 0.15; // weight for tip size (log domain)
    const aSize = -0.25; // penalty for bundle size
    const aTime = 0.05; // benefit for more time to deadline
    const aAtomic = 0.2; // slight boost if atomic (implies parallel relay strategy)

    const x = a0
      + aInc * Math.log(Math.max(1e-3, meanInc))
      + aTip * Math.log(1 + tipGwei)
      + aSize * size
      + aTime * (timeToDeadlineSec / 30)
      + aAtomic * (plan.atomic ? 1 : 0);

    const pInclusion = Math.min(0.999, Math.max(0.001, sigmoid(x)));

    // Expected latency: mean RTT + minor per-tx overhead, bounded by time-to-deadline
    const pLatencyMs = Math.min(plan.deadline - now, Math.max(50, meanRtt + size * 25));

    const out: InclusionPrediction = { pInclusion, pLatencyMs };

    // Observability
    console.info('[edge][InclusionPredictor] predict', {
      size, tipGwei, meanInc, meanRtt, timeToDeadlineSec,
      pInclusion: Number(pInclusion.toFixed(4)),
      pLatencyMs: Math.round(pLatencyMs)
    });

    const rec = {
      ts: new Date().toISOString(),
      kind: 'prediction',
      inputs: { size, tipGwei, meanInc, meanRtt, timeToDeadlineSec },
      output: out,
    };
    fs.mkdir('logs', { recursive: true }).catch(() => void 0).then(() =>
      fs.appendFile('logs/inclusion-stats.jsonl', JSON.stringify(rec) + '\n')
    ).catch(() => void 0);

    return out;
  }
}

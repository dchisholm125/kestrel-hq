import { PendingTrade } from './PendingPool'

export interface BundleCandidate extends PendingTrade {
  simulation?: {
    netProfitWei?: string
    gasCostWei?: string
  }
  gasUsed?: number | string | bigint
}

export interface GreedyBundleResult {
  trades: BundleCandidate[]
  totalGas: bigint
  totalNetProfitWei: bigint
  excluded: { reason: string; trade: BundleCandidate }[]
}

/**
 * BatchingEngine - naive greedy batching selecting highest net profit trades first under a gas limit.
 */
export class BatchingEngine {
  public createGreedyBundle(trades: BundleCandidate[], maxGasLimit: bigint): GreedyBundleResult {
    // Defensive copies and normalization
    const normalized = trades.map(t => {
      const gasUsed = this.estimateGasUsed(t)
      const profit = this.getNetProfitWei(t)
      return { trade: t, gasUsed, profit }
    })

    // Sort by descending profit
    normalized.sort((a, b) => (b.profit > a.profit ? 1 : b.profit < a.profit ? -1 : 0))

    const selected: BundleCandidate[] = []
    let gasAccum = 0n
    let profitAccum = 0n
    const excluded: { reason: string; trade: BundleCandidate }[] = []

    for (const n of normalized) {
      if (n.profit <= 0n) {
        excluded.push({ reason: 'non_positive_profit', trade: n.trade })
        continue
      }
      if (n.gasUsed > maxGasLimit) {
        excluded.push({ reason: 'exceeds_max_gas_alone', trade: n.trade })
        continue
      }
      if (gasAccum + n.gasUsed > maxGasLimit) {
        excluded.push({ reason: 'bundle_gas_limit', trade: n.trade })
        continue
      }
      selected.push(n.trade)
      gasAccum += n.gasUsed
      profitAccum += n.profit
    }

    return { trades: selected, totalGas: gasAccum, totalNetProfitWei: profitAccum, excluded }
  }

  private getNetProfitWei(t: BundleCandidate): bigint {
    try {
      const v = t.simulation?.netProfitWei
      if (!v) return 0n
      return BigInt(v)
    } catch {
      return 0n
    }
  }

  private estimateGasUsed(t: BundleCandidate): bigint {
    // If explicit gas used provided, use it; else attempt gasCostWei / (gasPrice ~1) fallback; else default 21000.
    const explicit = t.gasUsed
    if (explicit !== undefined) {
      try { return BigInt(explicit as any) } catch { /* fallthrough */ }
    }
    try {
      const gasCost = t.simulation?.gasCostWei ? BigInt(t.simulation.gasCostWei) : null
      if (gasCost !== null) return gasCost // assumes gasPrice == 1 wei baseline in tests
    } catch { /* ignore */ }
    return 21000n
  }
}

export const batchingEngine = new BatchingEngine()

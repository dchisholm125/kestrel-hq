/**
 * PendingPool
 * A simple in-memory store for validated trades (raw transaction submissions or enriched objects).
 * NOTE: This is an MVP, non-persistent structure. Future upgrades may add TTL eviction, indexing, or database backing.
 */
export type PendingTrade = {
  id: string
  rawTransaction: string
  txHash: string
  receivedAt: number
  // Additional metadata can be appended later (sim results, profit, etc.)
  [k: string]: unknown
}

class PendingPool {
  private trades: PendingTrade[] = []
  private seenHashes: Set<string> = new Set() // to prevent duplicates

  constructor() {
    // Intentionally empty; reserved for future instrumentation / metrics hooks
  }

  /** Add a trade object to the pool */
  public addTrade(trade: PendingTrade): void {
    if (!trade.txHash) {
      console.warn('[PendingPool] attempted to add trade without txHash; ignoring')
      return
    }
    const h = trade.txHash.toLowerCase()
    if (this.seenHashes.has(h)) {
      console.info('[PendingPool] duplicate trade ignored', { txHash: h })
      return
    }
    this.trades.push(trade)
    this.seenHashes.add(h)
    console.info('[PendingPool] trade added', { id: trade.id, txHash: h, total: this.trades.length })
  }

  /** Return a snapshot array of all trades (shallow copy to prevent external mutation). */
  public getTrades(): PendingTrade[] {
    return [...this.trades]
  }

  /** Clear all trades (testing / maintenance helper). */
  public clear(): void {
    this.trades.length = 0
    this.seenHashes.clear()
  }

  /** Remove trades whose txHash (case-insensitive) is in the provided array. Returns number removed. */
  public removeTrades(hashes: string[]): number {
    if (!hashes || hashes.length === 0) return 0
    const target = new Set(hashes.map(h => h.toLowerCase()))
    const before = this.trades.length
    if (before === 0) return 0
    this.trades = this.trades.filter(t => !target.has(t.txHash.toLowerCase()))
    // Rebuild seenHashes from remaining trades to keep it consistent
    this.seenHashes = new Set(this.trades.map(t => t.txHash.toLowerCase()))
    const removed = before - this.trades.length
    console.info('[PendingPool] removed trades', { removed, remaining: this.trades.length })
    return removed
  }

  /**
   * Re-validate trades considered stale (older than staleAfterMs) using the provided simulator.
   * Any trade for which simulator.analyze() does not return decision: 'ACCEPT' will be removed.
   * Returns a summary { checked, removed }.
   * Optional "nowOverride" is exposed for deterministic testing without external time mocking libs.
   */
  public async revalidateStale(
    simulator: { analyze(raw: string): Promise<{ decision: string; reason?: string }> },
    staleAfterMs: number,
    nowOverride?: number
  ): Promise<{ checked: number; removed: number }> {
    const now = nowOverride ?? Date.now()
    const stale = this.trades.filter(t => now - t.receivedAt > staleAfterMs)
    if (stale.length === 0) return { checked: 0, removed: 0 }
    const toRemove: string[] = []
    for (const trade of stale) {
      try {
        const res = await simulator.analyze(trade.rawTransaction)
        if (res.decision !== 'ACCEPT') {
          toRemove.push(trade.txHash)
          console.info('[PendingPool] revalidation removing trade', { txHash: trade.txHash, reason: res.reason })
        }
      } catch (e) {
        // On simulator error, err on side of removal to avoid acting on unknown state
        toRemove.push(trade.txHash)
        console.warn('[PendingPool] revalidation error -> removing trade', { txHash: trade.txHash, error: (e as Error).message })
      }
    }
    const removed = this.removeTrades(toRemove)
    return { checked: stale.length, removed }
  }
}

export default PendingPool

// Export a shared instance for application usage
export const pendingPool = new PendingPool()


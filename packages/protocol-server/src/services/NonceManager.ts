import { JsonRpcProvider } from 'ethers'
import { ENV } from '../config'

/**
 * NonceManager
 * - Singleton
 * - Tracks next-available nonce per address in-memory
 * - Protects getNextNonce with a simple per-address mutex to prevent races
 */
export class NonceManager {
  private static instance: NonceManager

  // Per-address next nonce cache
  private nextNonce: Map<string, bigint> = new Map()

  // Simple per-address FIFO mutex queues
  private queues: Map<string, Array<() => void>> = new Map()

  // Track in-flight (leased) nonces per address for reuse on reschedule
  private leased: Map<string, Array<{ nonce: bigint; txHash?: string }>> = new Map()

  // Provider used to fetch on-chain nonces when cache miss
  private provider: any

  private constructor(provider?: any) {
    // Default to ENV RPC if not provided
    this.provider = provider || new JsonRpcProvider(ENV.RPC_URL)
  }

  public static getInstance(provider?: any): NonceManager {
    if (!NonceManager.instance) {
      NonceManager.instance = new NonceManager(provider)
    } else if (provider) {
      // Allow late provider injection/override when instance already exists
      ;(NonceManager.instance as any).provider = provider
    }
    return NonceManager.instance
  }

  /** Acquire a lock for an address (FIFO). Resolves when lock is held. */
  private async acquire(address: string): Promise<void> {
    const key = address.toLowerCase()
    const queue = this.queues.get(key) || []

    let resolver: () => void
    const p = new Promise<void>((resolve) => (resolver = resolve))
    queue.push(resolver!)
    this.queues.set(key, queue)

    // If we're the only waiter, acquire immediately
    if (queue.length === 1) {
      resolver!()
    }

    // Wait until our resolver is invoked (lock acquired)
    return p
  }

  /** Release a lock for an address. */
  private release(address: string) {
    const key = address.toLowerCase()
    const queue = this.queues.get(key)
    if (!queue || queue.length === 0) return
    // Remove current holder
    queue.shift()
    if (queue.length === 0) {
      this.queues.delete(key)
    } else {
      // Wake next waiter
      const next = queue[0]
      next()
    }
  }

  /**
   * Get the next nonce for an address, atomically:
   * - If missing in cache, fetch from chain (pending tx count) and store
   * - Return current value and increment cache
   */
  public async reserveNonce(address: string, providerOverride?: any): Promise<bigint> {
    const key = address.toLowerCase()
    const provider = providerOverride || this.provider
    if (!provider) throw new Error('NonceManager: no provider available')

    await this.acquire(key)
    try {
  // Ensure leased list exists
  if (!this.leased.has(key)) this.leased.set(key, [])
  const leases = this.leased.get(key)!

      let current: bigint
      if (this.nextNonce.has(key)) {
        current = this.nextNonce.get(key)!
      } else {
        const onChain = await provider.getTransactionCount(address, 'pending')
        const seed = BigInt(onChain)
        this.nextNonce.set(key, seed)
        current = seed
        try {
          console.log(`[NonceManager] Seeded nonce for ${key} from chain: ${seed}`)
        } catch {}
      }

      // Create lease and increment for next caller
  leases.push({ nonce: current })
      this.nextNonce.set(key, current + 1n)
      try {
        console.log(`[NonceManager] Reserved nonce ${current} for ${key} (next=${this.nextNonce.get(key)})`)
      } catch {}
      return current
    } finally {
      this.release(key)
    }
  }

  /** Mark that a reserved nonce has been broadcast with a tx hash */
  public markBroadcast(addr: string, nonce: bigint, txHash: string): void {
    const key = addr.toLowerCase()
    const leases = this.leased.get(key)
    if (!leases) return
    const found = leases.find(l => l.nonce === nonce)
    if (found) found.txHash = txHash
  }

  /** Mark that the reserved nonce was included or dropped; release the lease */
  public markIncludedOrDropped(addr: string, nonce: bigint): void {
    const key = addr.toLowerCase()
    const leases = this.leased.get(key)
    if (!leases) return
    const idx = leases.findIndex(l => l.nonce === nonce)
    if (idx >= 0) {
      leases.splice(idx, 1)
      if (leases.length === 0) this.leased.delete(key)
    }
  }

  /** Force refresh from chain pending count (resets nextNonce; keeps lease if present) */
  public async refreshFromChain(addr: string): Promise<void> {
    const key = addr.toLowerCase()
    const onChain = await this.provider.getTransactionCount(addr, 'pending')
    const seed = BigInt(onChain)
    this.nextNonce.set(key, seed)
    try {
      console.log(`[NonceManager] Refreshed nonce from chain for ${key}: ${seed}`)
    } catch {}
  }

  /** Peek current lease for an address, if any */
  public peekLease(addr: string): { nonce: bigint; txHash?: string } | undefined {
    const leases = this.leased.get(addr.toLowerCase())
    if (!leases || leases.length === 0) return undefined
    return leases[leases.length - 1]
  }
}

export default NonceManager

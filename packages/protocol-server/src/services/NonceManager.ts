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
  private nextNonce: Map<string, number> = new Map()

  // Simple per-address FIFO mutex queues
  private queues: Map<string, Array<() => void>> = new Map()

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
  public async getNextNonce(address: string, providerOverride?: any): Promise<number> {
    const key = address.toLowerCase()
    const provider = providerOverride || this.provider
    if (!provider) throw new Error('NonceManager: no provider available')

    await this.acquire(key)
    try {
      let current: number
      if (this.nextNonce.has(key)) {
        current = this.nextNonce.get(key)!
      } else {
        const onChain = await provider.getTransactionCount(address, 'pending')
        this.nextNonce.set(key, onChain)
        current = onChain
        try {
          console.log(`[NonceManager] Seeded nonce for ${key} from chain: ${onChain}`)
        } catch {}
      }

      // Return current and increment for next caller
      this.nextNonce.set(key, current + 1)
      try {
        console.log(`[NonceManager] Allocated nonce ${current} for ${key} (next=${current + 1})`)
      } catch {}
      return current
    } finally {
      this.release(key)
    }
  }
}

export default NonceManager

import { JsonRpcProvider, TransactionResponse } from 'ethers'

// Environment: MAINNET_RPC_URL must be set
const INFURA_URL = process.env.INFURA_RPC_URL
const ALCHEMY_URL = process.env.ALCHEMY_RPC_URL

if (!INFURA_URL && !ALCHEMY_URL) {
  console.error('[replay] INFURA_RPC_URL or ALCHEMY_RPC_URL not set')
  process.exit(1)
}

// Provider rotation for rate limiting
class ProviderManager {
  private providers: { url: string; provider: JsonRpcProvider; name: string }[] = []
  private currentIndex = 0
  private rateLimitCooldowns: Map<number, number> = new Map()

  constructor() {
    if (INFURA_URL) {
      this.providers.push({
        url: INFURA_URL,
        provider: new JsonRpcProvider(INFURA_URL),
        name: 'Infura'
      })
    }
    if (ALCHEMY_URL) {
      this.providers.push({
        url: ALCHEMY_URL,
        provider: new JsonRpcProvider(ALCHEMY_URL),
        name: 'Alchemy'
      })
    }
  }

  getCurrentProvider() {
    return this.providers[this.currentIndex]
  }

  async makeRequest<T>(requestFn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    const maxRetries = this.providers.length
    let attempts = 0

    while (attempts < maxRetries) {
      const { provider, name } = this.providers[this.currentIndex]

      try {
        const result = await requestFn(provider)
        return result
      } catch (error: any) {
        // Check for rate limiting errors from RPC providers
        const isRateLimit = error?.code === 'BAD_DATA' &&
                           (error?.error?.code === -32005 ||
                            error?.error?.message?.includes('Too Many Requests') ||
                            error?.message?.includes('Too Many Requests'))

        if (isRateLimit) {
          console.log(`[replay] Rate limited on ${name}, switching provider...`)
          this.rotateProvider()
          attempts++
          await this.sleep(1000) // Brief pause before retry
        } else {
          throw error
        }
      }
    }

    throw new Error('All providers rate limited')
  }

  private rotateProvider() {
    this.currentIndex = (this.currentIndex + 1) % this.providers.length
    const { name } = this.providers[this.currentIndex]
    console.log(`[replay] Switched to ${name}`)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

const providerManager = new ProviderManager()
const localProvider = new JsonRpcProvider('http://127.0.0.1:8545')

// Replay a single block worth of transactions
export async function replayBlock(blockNumber: number) {
  const block = await providerManager.makeRequest(async (provider) => {
    return await provider.getBlock(blockNumber, true)
  })

  if (!block) {
    console.warn(`[replay] block ${blockNumber} not found on remote provider`)
    return
  }
  const txs = block.transactions
  console.log(`[replay] block ${blockNumber} -> ${txs.length} txs`)
  let index = 0
  for (const tx of txs) {
    index += 1
    try {
      // If provider returned hashes instead of full objects (defensive) re-fetch
      let fullTx: TransactionResponse
      if (typeof tx === 'string') {
        const fetched = await providerManager.makeRequest(async (provider) => {
          return await provider.getTransaction(tx)
        })
        if (!fetched) {
          console.warn(`[replay] tx ${tx} missing; skipping`)
          continue
        }
        fullTx = fetched
      } else {
        fullTx = tx as TransactionResponse
      }

      // ethers v6 TransactionResponse has 'serialized' via "raw" getter => use provider.send
      // Some providers may not expose raw on already-mined tx; reconstruct raw if needed.
      // For simplicity we leverage the built-in .serialize() if present via `fullTx.serialized` or `fullTx.raw`.
      // Fallback: attempt to populate fields and send as raw hex if raw not available.
      const raw = (fullTx as any).serialized || (fullTx as any).raw
      if (!raw) {
        console.warn(`[replay] tx ${fullTx.hash} missing raw serialization; skipping`)
        continue
      }

      console.log(`[replay] (${index}/${txs.length}) sending ${fullTx.hash} from block ${blockNumber}`)
      await localProvider.send('eth_sendRawTransaction', [raw])
    } catch (e: any) {
      const msg = e?.error?.message || e?.message || String(e)
      // Ignore already known / nonce or intrinsic gas errors to keep stream flowing
      if (/known|nonce|replacement|already imported|intrinsic/i.test(msg)) {
        console.log(`[replay] (${index}/${txs.length}) tx skipped (${msg})`)
      } else {
        console.warn(`[replay] (${index}/${txs.length}) error sending tx: ${msg}`)
      }
    }
  }
}

// Simple sleep helper
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

async function main() {
  // Parse CLI args (e.g., --startBlock 18000000)
  const args = process.argv.slice(2)
  let startBlock: number | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--startBlock' && args[i + 1]) {
      startBlock = parseInt(args[i + 1], 10)
      i += 1
    }
  }
  if (!startBlock || Number.isNaN(startBlock)) {
    console.error('[replay] --startBlock <number> is required')
    process.exit(1)
  }

  console.log(`[replay] Starting historical replay from block ${startBlock}`)
  let current = startBlock
  while (true) {
    await replayBlock(current)
    current += 1
    await sleep(1500) // ~1.5s cadence
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[replay] fatal error', e)
    process.exit(1)
  })
}

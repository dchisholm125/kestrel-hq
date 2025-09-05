import { JsonRpcProvider, TransactionResponse, Transaction } from 'ethers'

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
  console.log(`[replay] Fetching block ${blockNumber} from mainnet...`)
  
  const block = await providerManager.makeRequest(async (provider) => {
    return await provider.getBlock(blockNumber, true)
  })

  if (!block) {
    console.warn(`[replay] Block ${blockNumber} not found on remote provider`)
    return
  }
  
  const txs = block.transactions
  console.log(`[replay] Block ${blockNumber} contains ${txs.length} transactions`)
  
  if (txs.length === 0) {
    console.log(`[replay] No transactions in block ${blockNumber}, mining empty block`)
    await localProvider.send('evm_mine', [])
    return
  }

  let sentCount = 0
  let index = 0
  
  for (const tx of txs) {
    index += 1
    try {
      // If provider returned hashes instead of full objects (defensive) re-fetch
      let fullTx: TransactionResponse
      if (typeof tx === 'string') {
        console.log(`[replay] (${index}/${txs.length}) Fetching full tx data for ${tx}`)
        const fetched = await providerManager.makeRequest(async (provider) => {
          return await provider.getTransaction(tx)
        })
        if (!fetched) {
          console.warn(`[replay] (${index}/${txs.length}) Transaction ${tx} missing; skipping`)
          continue
        }
        fullTx = fetched
      } else {
        fullTx = tx as TransactionResponse
      }

      // Get raw transaction data
      let raw: string | null = null

      // Try to get raw from existing properties first
      if ((fullTx as any).serialized) {
        raw = (fullTx as any).serialized
      } else if ((fullTx as any).raw) {
        raw = (fullTx as any).raw
      }

      // If no raw available, try to reconstruct from transaction object
      if (!raw) {
        try {
          const reconstructedTx = Transaction.from(fullTx)
          raw = reconstructedTx.serialized
          console.log(`[replay] (${index}/${txs.length}) Reconstructed raw for ${fullTx.hash} (Type ${reconstructedTx.type})`)
        } catch (reconstructError: any) {
          console.warn(`[replay] (${index}/${txs.length}) Failed to reconstruct raw for ${fullTx.hash}: ${reconstructError.message}`)
          continue
        }
      }

      if (!raw) {
        console.warn(`[replay] (${index}/${txs.length}) Transaction ${fullTx.hash} missing raw serialization; skipping`)
        continue
      }

      console.log(`[replay] (${index}/${txs.length}) Sending tx ${fullTx.hash} (${fullTx.value ? `${fullTx.value} wei` : '0 wei'}) to ${fullTx.to || 'contract creation'}`)
      await localProvider.send('eth_sendRawTransaction', [raw])
      sentCount++
      
    } catch (e: any) {
      const msg = e?.error?.message || e?.message || String(e)
      // Ignore already known / nonce or intrinsic gas errors to keep stream flowing
      if (/known|nonce|replacement|already imported|intrinsic/i.test(msg)) {
        console.log(`[replay] (${index}/${txs.length}) Transaction skipped (${msg})`)
      } else {
        console.warn(`[replay] (${index}/${txs.length}) Error sending transaction: ${msg}`)
      }
    }
  }
  
  console.log(`[replay] Sent ${sentCount}/${txs.length} transactions for block ${blockNumber}`)
  
  // Mine the block to include all transactions
  console.log(`[replay] Mining block ${blockNumber} with ${sentCount} transactions...`)
  await localProvider.send('evm_mine', [])
  
  // Get the mined block number
  const currentBlock = await localProvider.getBlockNumber()
  console.log(`[replay] Block ${blockNumber} mined as local block ${currentBlock}`)
  
  // Wait a moment for bots to process
  await sleep(500)
}

// Simple sleep helper
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

async function main() {
  // Parse CLI args (e.g., --startBlock 18000000)
  const args = process.argv.slice(2)
  let startBlock: number | undefined
  let blockCount: number = 10 // Default to 10 blocks
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--startBlock' && args[i + 1]) {
      startBlock = parseInt(args[i + 1], 10)
      i += 1
    } else if (args[i] === '--count' && args[i + 1]) {
      blockCount = parseInt(args[i + 1], 10)
      i += 1
    }
  }
  
  if (!startBlock || Number.isNaN(startBlock)) {
    console.error('[replay] --startBlock <number> is required')
    process.exit(1)
  }

  console.log(`[replay] 🚀 Starting historical replay from block ${startBlock}`)
  console.log(`[replay] 📊 Will process ${blockCount} blocks`)
  console.log(`[replay] 🔗 Using providers: ${providerManager.getCurrentProvider().name}`)
  console.log(`[replay] ⛏️  Local anvil at http://127.0.0.1:8545`)
  console.log(`[replay] 📡 Bots should be listening for new blocks...`)
  console.log(`[replay] ──────────────────────────────────────────────────`)

  let current = startBlock
  let processedBlocks = 0
  
  while (processedBlocks < blockCount) {
    try {
      console.log(`[replay] ──────────────────────────────────────────────────`)
      console.log(`[replay] 📦 Processing block ${current} (${processedBlocks + 1}/${blockCount})`)
      
      await replayBlock(current)
      
      processedBlocks++
      current += 1
      
      // Wait between blocks to allow bots to process
      console.log(`[replay] ⏳ Waiting 2 seconds before next block...`)
      await sleep(2000)
      
    } catch (error: any) {
      console.error(`[replay] ❌ Error processing block ${current}:`, error.message)
      console.log(`[replay] ⏭️  Skipping to next block...`)
      current += 1
      processedBlocks++
      await sleep(1000)
    }
  }
  
  console.log(`[replay] ──────────────────────────────────────────────────`)
  console.log(`[replay] ✅ Replay complete! Processed ${processedBlocks} blocks`)
  console.log(`[replay] 🎯 Check bot logs to see if they detected profitable trades!`)
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[replay] fatal error', e)
    process.exit(1)
  })
}

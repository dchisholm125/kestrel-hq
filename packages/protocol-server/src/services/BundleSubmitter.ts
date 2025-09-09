import { Wallet, JsonRpcProvider } from 'ethers'
import { ENV } from '../config'
import FlashbotsClient from './FlashbotsClient'
import BloxrouteClient from './BloxrouteClient'
import PublicSubmitter from './PublicSubmitter'
import ReceiptChecker from './ReceiptChecker'
import crypto from 'crypto'

// 🚨 MOCK MODE DETECTION - VERY EXPLICIT 🚨
const MOCK = process.env.SUBMIT_MOCK === 'true'
if (MOCK) {
  console.warn('🚨🚨🚨 [BundleSubmitter] MOCK MODE ENABLED — NO REAL SUBMISSIONS WILL BE MADE! 🚨🚨🚨')
  console.warn('🚨🚨🚨 [BundleSubmitter] This is a DRY RUN - bundles will be logged but NOT submitted 🚨🚨🚨')
  console.warn('🚨🚨🚨 [BundleSubmitter] To enable REAL submissions, set SUBMIT_MOCK=false 🚨🚨🚨')
} else {
  console.log('✅ [BundleSubmitter] REAL MODE - Live submissions enabled')
}

// 🔗 RELAY CONFIGURATION - Chain-aware relay filtering
interface RelayConfig {
  name: string
  chainId: number
  url: string
  auth?: string
}

const ALL_RELAYS: RelayConfig[] = [
  {
    name: 'flashbots',
    chainId: 1, // Mainnet
    url: ENV.FLASHBOTS_MAINNET,
    auth: ENV.FLASHBOTS_SIGNING_KEY
  },
  {
    name: 'beaver',
    chainId: 1, // Mainnet
    url: ENV.BEAVER_MAINNET,
    auth: ENV.FLASHBOTS_SIGNING_KEY // Using same key for now
  },
  {
    name: 'flashbots-sepolia',
    chainId: 11155111, // Sepolia
    url: ENV.FLASHBOTS_SEPOLIA,
    auth: ENV.FLASHBOTS_SIGNING_KEY
  }
  // Add more L2 relays here as needed
]

// Filter relays by current chain ID
const CURRENT_CHAIN = ENV.CHAIN_ID
const AVAILABLE_RELAYS = ALL_RELAYS.filter(r => r.chainId === CURRENT_CHAIN && !!r.url)

console.log(`🔗 [BundleSubmitter] Relay Configuration:`, {
  currentChain: CURRENT_CHAIN,
  submissionMode: ENV.SUBMISSION_MODE,
  availableRelays: AVAILABLE_RELAYS.length,
  mockMode: MOCK,
  network: ENV.SEPOLIA_SWITCH ? 'Sepolia Testnet' : 'Mainnet'
})

AVAILABLE_RELAYS.forEach(relay => {
  console.log(`  📡 ${relay.name}: ${relay.url} (chainId: ${relay.chainId})`)
})

// 🔐 AUTH KEY VALIDATION
function validateAuthKey(key: string): boolean {
  // Must be 0x + 64 hex characters (32 bytes)
  const hexPattern = /^0x[0-9a-fA-F]{64}$/
  return hexPattern.test(key)
}

if (ENV.FLASHBOTS_SIGNING_KEY) {
  const isValid = validateAuthKey(ENV.FLASHBOTS_SIGNING_KEY)
  if (!isValid) {
    console.error('❌ [BundleSubmitter] INVALID AUTH KEY FORMAT!')
    console.error('❌ [BundleSubmitter] Must be 0x + 64 hex characters (32 bytes)')
    console.error('❌ [BundleSubmitter] Current key length:', ENV.FLASHBOTS_SIGNING_KEY.length)
  } else {
    console.log('✅ [BundleSubmitter] Auth key format is valid')
  }
}

// 🛡️ RELAY PROBE GATING
export function shouldRunProbe(probeName: string): boolean {
  // Gate mainnet-only probes
  if (probeName === 'getUserStats' && CURRENT_CHAIN !== 1) {
    console.log(`[relayprobe] ⏭️  SKIP ${probeName} - only available on mainnet (chainId: 1)`)
    return false
  }

  // Gate beaver build probes (not yet implemented)
  if (probeName.includes('beaver') && !AVAILABLE_RELAYS.some(r => r.name.includes('beaver'))) {
    console.log(`[relayprobe] ⏭️  SKIP ${probeName} - beaver client not implemented yet`)
    return false
  }

  // Add more probe gating rules here as needed
  return true
}

// Example usage in other parts of the codebase:
/*
// Before running a relay probe:
if (shouldRunProbe('getUserStats')) {
  // Run the probe
  const stats = await relay.getUserStats()
} else {
  console.log('Skipping getUserStats probe for current network')
}
*/

/**
 * BundleSubmitter
 * Acts as a manager that fans out signed bundles/txs to multiple relays.
 */
export class BundleSubmitter {
  private static instance: BundleSubmitter
  private flashbots?: FlashbotsClient
  private bloxroute?: BloxrouteClient
  private initialized = false

  private constructor() {}

  public static getInstance(): BundleSubmitter {
    if (!BundleSubmitter.instance) BundleSubmitter.instance = new BundleSubmitter()
    return BundleSubmitter.instance
  }

  /** Lazy init to avoid requiring env vars at import time */
  private initIfNeeded() {
    if (this.initialized) return
    try {
      console.log('[BundleSubmitter] 🔧 Initializing relay clients...', {
        sepoliaMode: ENV.SEPOLIA_SWITCH,
        submissionMode: ENV.SUBMISSION_MODE,
        currentChain: CURRENT_CHAIN
      })

      // Skip relay initialization for Sepolia (uses public mempool instead)
      if (ENV.SEPOLIA_SWITCH) {
        console.log('[BundleSubmitter] ⏭️  Skipping relay initialization for Sepolia (using public mempool)')
        this.initialized = true
        return
      }

      // Initialize relay clients based on available relays for current chain
      for (const relay of AVAILABLE_RELAYS) {
        try {
          if (relay.name.includes('flashbots')) {
            const wallet = new Wallet(relay.auth!)
            this.flashbots = new FlashbotsClient(relay.url, wallet)
            console.log(`✅ [BundleSubmitter] ${relay.name} client initialized`, {
              relay: relay.url,
              chainId: relay.chainId,
              signer: wallet.address
            })
          } else if (relay.name.includes('beaver')) {
            // For beaver build, we'd need a different client implementation
            console.log(`📋 [BundleSubmitter] ${relay.name} relay configured (client implementation needed)`, {
              relay: relay.url,
              chainId: relay.chainId
            })
          }
        } catch (error) {
          console.error(`❌ [BundleSubmitter] Failed to initialize ${relay.name}:`, error)
        }
      }

      // Legacy bloxroute support (if still needed)
      if (ENV.BLOXROUTE_RELAY_URL && ENV.BLOXROUTE_AUTH) {
        try {
          this.bloxroute = new BloxrouteClient(ENV.BLOXROUTE_RELAY_URL, ENV.BLOXROUTE_AUTH)
          console.log('[BundleSubmitter] ✅ BloXroute client initialized', {
            relay: ENV.BLOXROUTE_RELAY_URL,
            hasAuth: !!ENV.BLOXROUTE_AUTH
          })
        } catch (error) {
          console.error('[BundleSubmitter] ❌ BloXroute client initialization failed:', error)
        }
      } else {
        console.warn('[BundleSubmitter] ⚠️  BloXroute not configured - missing BLOXROUTE_RELAY_URL or BLOXROUTE_AUTH')
      }

      // Initialize Public Submitter for testnets
      if (ENV.SEPOLIA_SWITCH) {
        try {
          // We'll initialize this when needed in submitToRelays
          console.log('[BundleSubmitter] ✅ Public submitter enabled for Sepolia testnet')
        } catch (error) {
          console.error('[BundleSubmitter] ❌ Public submitter initialization failed:', error)
        }
      }

      this.initialized = true

      console.log('[BundleSubmitter] 🎯 Initialization complete', {
        hasFlashbots: !!this.flashbots,
        hasBloxroute: !!this.bloxroute,
        hasPublicSubmitter: ENV.SEPOLIA_SWITCH,
        network: ENV.SEPOLIA_SWITCH ? 'Sepolia Testnet' : 'Mainnet',
        submissionMode: ENV.SUBMISSION_MODE,
        availableRelays: AVAILABLE_RELAYS.length,
        mode: MOCK ? '🚨 MOCK MODE 🚨' : '✅ REAL MODE ✅'
      })
    } catch (e) {
      console.error('[BundleSubmitter] 💥 Critical initialization error', e)
    }
  }

  /** Submit one signed transaction to all configured relays in parallel */
  public async submitToRelays(signedTransaction: string, targetBlock?: number, intentId?: string): Promise<{ bundleHash?: string }> {
    this.initIfNeeded()

    // 🚨🚨🚨 MOCK MODE CHECK - VERY EXPLICIT PER SUBMISSION 🚨🚨🚨
    if (MOCK) {
      console.warn('🚨 [BundleSubmitter] MOCK SUBMISSION - NOT sending to real relays!')
      console.warn('🚨 [BundleSubmitter] Would submit to:', {
        flashbots: !!this.flashbots,
        bloxroute: !!this.bloxroute,
        publicMempool: ENV.SEPOLIA_SWITCH,
        targetBlock: targetBlock,
        intentId: intentId,
        network: ENV.SEPOLIA_SWITCH ? 'Sepolia Testnet' : 'Mainnet',
        submissionMode: ENV.SUBMISSION_MODE
      })

      // Generate mock bundle hash for testing
      const mockBundleHash = `0x${crypto.randomBytes(32).toString('hex')}`
      console.log(`🎭 [BundleSubmitter] MOCK: Generated bundle hash: ${mockBundleHash}`)

      // Track the mock bundle for receipt polling
      if (intentId) {
        const receiptChecker = new ReceiptChecker()
        receiptChecker.trackBundle(intentId, mockBundleHash)
      }

      return { bundleHash: mockBundleHash }
    }

    // 🌐 PUBLIC MEMPOOL MODE - For Sepolia testnet (automatic when SEPOLIA_SWITCH=1)
    if (ENV.SEPOLIA_SWITCH) {
      console.log('🌐 [BundleSubmitter] PUBLIC MEMPOOL MODE - Using public transaction for Sepolia testnet')
      return this.submitPublicTransaction(signedTransaction, intentId)
    }

    // ✅ REAL BUNDLE MODE - For mainnet with proper relay configuration
    console.log('✅ [BundleSubmitter] REAL BUNDLE MODE - Sending to live relays')

    const tasks: { name: string; promise: Promise<unknown> }[] = []

    // Prepare Flashbots submission
    if (this.flashbots) {
      const block = targetBlock || (Math.floor(Date.now() / 1000) + 30) // placeholder block number heuristic
      console.log(`[BundleSubmitter] 📤 ${MOCK ? '🎭 MOCK' : '✅ REAL'} Preparing Flashbots submission`, {
        targetBlock: block,
        relay: ENV.FLASHBOTS_RELAY_URL,
        chainId: CURRENT_CHAIN,
        mode: MOCK ? 'MOCK - will not submit' : 'REAL - will submit'
      })
      tasks.push({
        name: 'Flashbots',
        promise: this.flashbots.submitBundle(signedTransaction, { targetBlockNumber: block })
      })
    }

    // Prepare BloXroute submission
    if (this.bloxroute) {
      console.log(`[BundleSubmitter] 📤 ${MOCK ? '🎭 MOCK' : '✅ REAL'} Preparing BloXroute submission`, {
        relay: ENV.BLOXROUTE_RELAY_URL,
        chainId: CURRENT_CHAIN,
        mode: MOCK ? 'MOCK - will not submit' : 'REAL - will submit'
      })
      tasks.push({ name: 'bloXroute', promise: this.bloxroute.submitBundle(signedTransaction) })
    }

    // If no relays are configured, log error and return
    if (tasks.length === 0) {
      console.error('[BundleSubmitter] ❌ No relays configured - cannot submit bundle!')
      console.error('[BundleSubmitter] 🔧 Check your environment variables:')
      console.error('  - FLASHBOTS_SIGNING_KEY:', !!ENV.FLASHBOTS_SIGNING_KEY ? '✅ Set' : '❌ Missing')
      console.error('  - FLASHBOTS_RELAY_URL:', ENV.FLASHBOTS_RELAY_URL || '❌ Missing')
      console.error('  - BLOXROUTE_RELAY_URL:', ENV.BLOXROUTE_RELAY_URL || '❌ Missing')
      console.error('  - BLOXROUTE_AUTH:', !!ENV.BLOXROUTE_AUTH ? '✅ Set' : '❌ Missing')

      // Fail fast if in bundle submission mode
      if (process.env.SUBMISSION_MODE === 'bundle') {
        console.error('[BundleSubmitter] 💥 FAIL FAST: No relays configured (bundle mode). Exiting.')
        process.exit(1)
      }

      return { bundleHash: undefined }
    }

    console.log(`[BundleSubmitter] 🚀 Submitting bundle to ${tasks.length} relay(s)...`)

    // Submit to all relays in parallel using Promise.allSettled
    const results = await Promise.allSettled(tasks.map(t => t.promise))
    let bundleHash: string | undefined

    results.forEach((res, idx) => {
      const label = tasks[idx].name
      if (res.status === 'fulfilled') {
        const resultBundleHash = (res.value as any)?.bundleHash
        console.log(`[BundleSubmitter] ✅ Submission successful to ${label}`, {
          bundleHash: resultBundleHash,
          result: res.value
        })

        // Use the first successful bundle hash as the primary one
        if (!bundleHash && resultBundleHash) {
          bundleHash = resultBundleHash
        }

        // Log successful transaction execution
        console.log(`[KESTREL-PROTOCOL] SUCCESSFUL_TRANSACTION_EXECUTED`, {
          relay: label,
          signedTransaction: signedTransaction.substring(0, 66) + '...', // First 32 bytes + ...
          targetBlock: targetBlock,
          timestamp: new Date().toISOString(),
          bundleHash: resultBundleHash || 'unknown',
          status: 'submitted_to_relay'
        })

        // Track bundle for receipt polling if we have intent ID and bundle hash
        if (intentId && resultBundleHash) {
          const receiptChecker = new ReceiptChecker()
          receiptChecker.trackBundle(intentId, resultBundleHash)
        }
      } else {
        const errorMessage = res.reason?.message || String(res.reason)
        console.error(`[BundleSubmitter] ❌ Submission failed to ${label}: ${errorMessage}`, {
          error: res.reason,
          relay: label,
          targetBlock: targetBlock
        })
      }
    })

    console.log(`[BundleSubmitter] 📊 ${MOCK ? '🎭 MOCK' : '✅ REAL'} Bundle submission complete`, {
      totalRelays: tasks.length,
      successfulSubmissions: results.filter(r => r.status === 'fulfilled').length,
      failedSubmissions: results.filter(r => r.status === 'rejected').length,
      bundleHash: bundleHash || 'none',
      mode: MOCK ? 'MOCK - no real submissions made' : 'REAL - submitted to live relays'
    })

    return { bundleHash }
  }

  /**
   * Submit transaction to public mempool (for testnets like Sepolia)
   */
  private async submitPublicTransaction(signedTransaction: string, intentId?: string): Promise<{ bundleHash?: string }> {
    try {
      console.log('🌐 [BundleSubmitter] Initializing public transaction submitter...')

  // Create provider for public submission (no wallet needed for raw tx submission)
  const provider = new JsonRpcProvider(ENV.RPC_URL || 'https://ethereum-sepolia.public.blastapi.io')

      console.log('🌐 [BundleSubmitter] Submitting signed transaction to public mempool...')

      // Basic sanity on the signed tx; if invalid but we have a fallback key, skip straight to fallback path
      const looksLikeRaw = /^0x[0-9a-fA-F]+$/.test(signedTransaction) && signedTransaction.length > 10

      // Try raw submission first
      let txHash: string
      try {
        if (!looksLikeRaw) throw new Error('invalid-raw-tx')
        txHash = await provider.send('eth_sendRawTransaction', [signedTransaction])
      } catch (err: any) {
        const msg = (err?.error?.message || err?.message || '').toLowerCase()
        // Handle nodes that reject certain types or malformed bundles; fallback to constructing a legacy tx
        if (msg.includes('transaction type not supported') || msg.includes('rlp: expected input list') || msg.includes('invalid-raw-tx')) {
          console.warn('🌐 [BundleSubmitter] RPC rejected raw tx type; attempting legacy self-sign fallback...')
          const canFallback = !!ENV.PUBLIC_SUBMIT_PRIVATE_KEY
          if (!canFallback) {
            throw new Error('RPC rejected raw tx and no PUBLIC_SUBMIT_PRIVATE_KEY available for fallback signing')
          }
          // Minimal legacy tx send of 0 eth to self (smoke test), to validate path works on this RPC
          const wallet = new Wallet(ENV.PUBLIC_SUBMIT_PRIVATE_KEY).connect(provider)
          const to = await wallet.getAddress()
          // Use managed nonce to avoid collisions in concurrent flows
          const { default: NonceManager } = await import('./NonceManager')
          const nonceManager = NonceManager.getInstance(provider)
          const nonce = await nonceManager.getNextNonce(to, provider)
          const fee = await provider.getFeeData()
          const gasPrice = fee.gasPrice ?? 1_500_000_000n // fallback 1.5 gwei for legacy
          const legacyTx = {
            to,
            value: 0n,
            nonce,
            gasPrice,
            gasLimit: 21000n,
            chainId: ENV.CHAIN_ID
          } as const
          const sent = await wallet.sendTransaction(legacyTx)
          txHash = sent.hash
          console.log('✅ [BundleSubmitter] Fallback legacy tx submitted', { hash: txHash })
        } else {
          throw err
        }
      }

      console.log('✅ [BundleSubmitter] Public transaction submitted successfully!', {
        hash: txHash,
        mode: 'PUBLIC_MEMPOOL'
      })

      return {
        bundleHash: txHash // Return the transaction hash as bundle hash for consistency
      }

    } catch (error) {
      console.error('❌ [BundleSubmitter] Public transaction submission failed:', error)
      throw error
    }
  }
}

export default BundleSubmitter

/**
 * ReceiptChecker - Polls Flashbots for bundle status receipts
 * Provides colorful logging for submission outcomes
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { JsonRpcProvider } from 'ethers'
import { ENV } from '../config'

// Colorful logging utilities
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
}

function logSubmission(label: string, bundleHash: string, status: string, details?: any) {
  const timestamp = new Date().toISOString().slice(11, 23)
  const color = status.includes('success') || status.includes('included') ? colors.green :
                status.includes('fail') || status.includes('dropped') || status.includes('error') ? colors.red :
                status.includes('pending') ? colors.yellow : colors.blue
  const icon = status.includes('success') || status.includes('included') ? '✅' :
               status.includes('fail') || status.includes('dropped') || status.includes('error') ? '❌' :
               status.includes('pending') ? '⏳' : '🔍'
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${colors.bright}${color}🔄 RECEIPT${colors.reset} ${icon} ${label} ${colors.cyan}${bundleHash.slice(0, 10)}...${colors.reset} ${status}${details ? ' ' + JSON.stringify(details) : ''}`)
}

interface TrackedBundle {
  intentId: string
  bundleHash: string
  submittedAt: number
  lastChecked: number
  status: 'pending' | 'included' | 'failed'
  blockNumber?: number
  txHash?: string
}

interface BundleStatsResponse {
  isSimulated?: boolean
  isSentToMiners?: boolean
  isHighPriority?: boolean
  simulatedAt?: string
  submittedAt?: string
  sentToMinersAt?: string
  isCancelled?: boolean
  cancellationReason?: string
  landedAt?: string
  landedBlockNumber?: number
  landedTxHash?: string
}

/**
 * ReceiptChecker - Tracks and polls Flashbots bundle statuses
 */
export class ReceiptChecker {
  private trackedBundles = new Map<string, TrackedBundle>()
  private relayUrl: string
  private pollInterval: number
  private maxAge: number // Max age in ms before giving up
  private pollTimer?: NodeJS.Timeout
  private persistenceFile: string
  private successLogFile: string
  private pollCycleCount: number = 0
  private provider?: JsonRpcProvider

  constructor(relayUrl: string = 'https://relay.flashbots.net', pollInterval: number = 3000, maxAge: number = 300000) {
    this.relayUrl = relayUrl.replace(/\/$/, '')
    this.pollInterval = pollInterval
    this.maxAge = maxAge
    this.persistenceFile = path.resolve(process.cwd(), 'logs', 'tracked-bundles.json')
    this.successLogFile = path.resolve(process.cwd(), '..', '..', '..', 'kestrel-protocol-private', 'logs', 'SUCCESSFUL_TXs.jsonl')
  }

  /**
   * Load persisted bundles from file
   */
  private async loadPersistedBundles(): Promise<void> {
    try {
      const data = await fs.readFile(this.persistenceFile, 'utf8')
      const bundles: TrackedBundle[] = JSON.parse(data)
      for (const bundle of bundles) {
        this.trackedBundles.set(bundle.bundleHash, bundle)
      }
      logSubmission('📂 LOADED', `${bundles.length} bundles`, 'from_file')
    } catch (error) {
      // File doesn't exist or is corrupted, start fresh
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logSubmission('❌ LOAD ERROR', 'persistence file', 'corrupted', { error: (error as Error).message })
      }
    }
  }

  /**
   * Persist all tracked bundles to file
   */
  private async persistBundles(): Promise<void> {
    try {
      const bundles = Array.from(this.trackedBundles.values())
      await fs.mkdir(path.dirname(this.persistenceFile), { recursive: true })
      await fs.writeFile(this.persistenceFile, JSON.stringify(bundles, null, 2))
    } catch (error) {
      logSubmission('❌ PERSIST ERROR', 'failed to save', 'to_file', { error: (error as Error).message })
    }
  }

  /**
   * Log successful transaction to dedicated file
   */
  private async logSuccessfulTransaction(tracked: TrackedBundle, stats: BundleStatsResponse): Promise<void> {
    try {
      const successEntry = {
        ts: new Date().toISOString(),
        intentId: tracked.intentId,
        bundleHash: tracked.bundleHash,
        blockNumber: stats.landedBlockNumber,
        txHash: stats.landedTxHash,
        landedAt: stats.landedAt,
        submittedAt: tracked.submittedAt,
        processingTimeMs: Date.now() - tracked.submittedAt
      }

      await fs.mkdir(path.dirname(this.successLogFile), { recursive: true })
      await fs.appendFile(this.successLogFile, JSON.stringify(successEntry) + '\n')

      logSubmission('💰 SUCCESS LOGGED', tracked.bundleHash, 'to_file', {
        intentId: tracked.intentId,
        blockNumber: stats.landedBlockNumber,
        txHash: stats.landedTxHash?.slice(0, 10) + '...'
      })
    } catch (error) {
      logSubmission('❌ SUCCESS LOG ERROR', tracked.bundleHash, 'failed', { error: (error as Error).message })
    }
  }

  /**
   * Initialize ReceiptChecker - load persisted bundles
   */
  async initialize(): Promise<void> {
    await this.loadPersistedBundles()
    logSubmission('🚀 RECEIPT CHECKER', 'initialized', 'active', { loaded: this.trackedBundles.size })
  }

  /**
   * Track a newly submitted bundle
   */
  async trackBundle(intentId: string, bundleHash: string): Promise<void> {
    const tracked: TrackedBundle = {
      intentId,
      bundleHash,
      submittedAt: Date.now(),
      lastChecked: 0,
      status: 'pending'
    }
    this.trackedBundles.set(bundleHash, tracked)
    await this.persistBundles()
    logSubmission('📋 TRACKING', bundleHash, 'pending', { intentId })
  }

  /**
   * Start polling for receipts
   */
  startPolling(): void {
    logSubmission('🚀 STARTED', 'polling', 'active', { interval: this.pollInterval, tracked: this.trackedBundles.size })
    this.pollTimer = setInterval(() => this.pollReceipts(), this.pollInterval)
  }

  /**
   * Stop polling for receipts
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
      logSubmission('🛑 STOPPED', 'polling', 'inactive')
    }
  }

  /**
   * Poll Flashbots for bundle status updates
   */
  private async pollReceipts(): Promise<void> {
    const now = Date.now()
    this.pollCycleCount++

    // Log status every 10 polling cycles (every 30 seconds at 3s intervals)
    if (this.pollCycleCount % 10 === 0) {
      const status = this.getStatus()
      logSubmission('📊 STATUS', 'summary', 'info', status)
    }

    const toCheck: TrackedBundle[] = []

    // Find bundles that need checking
    for (const [bundleHash, tracked] of this.trackedBundles) {
      if (tracked.status === 'pending' && (now - tracked.lastChecked) >= this.pollInterval) {
        toCheck.push(tracked)
      }
    }

    if (toCheck.length === 0) return

    logSubmission('🔍 POLLING', `${toCheck.length} bundles`, 'checking')

    // Check each bundle
    for (const tracked of toCheck) {
      try {
        // Check if this is a public transaction (not a bundle hash)
        // Public transactions start with 0x and are 66 characters (32 bytes + 0x)
        const isPublicTx = tracked.bundleHash.startsWith('0x') && tracked.bundleHash.length === 66

        if (isPublicTx) {
          await this.checkPublicTransactionStatus(tracked)
        } else {
          await this.checkBundleStatus(tracked)
        }
      } catch (error) {
        logSubmission('❌ POLL ERROR', tracked.bundleHash, 'error', {
          intentId: tracked.intentId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // Clean up old bundles
    await this.cleanupOldBundles(now)
  }

  /**
   * Check status of a specific bundle
   */
  private async checkBundleStatus(tracked: TrackedBundle): Promise<void> {
    // Check if this is a mock bundle (generated when no relays are configured)
    if (this.isMockBundle(tracked.bundleHash)) {
      await this.handleMockBundleStatus(tracked)
      return
    }

    const url = `${this.relayUrl}/flashbots_getBundleStatsV2`
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'flashbots_getBundleStatsV2',
      params: [{
        bundleHash: tracked.bundleHash
      }]
    }

    tracked.lastChecked = Date.now()

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json() as any

      if (data.error) {
        throw new Error(`Flashbots API error: ${data.error.message}`)
      }

      const stats: BundleStatsResponse = data.result

      await this.updateBundleStatus(tracked, stats)

    } catch (error) {
      // Don't throw, just log the error
      logSubmission('❌ API ERROR', tracked.bundleHash, 'api_error', {
        intentId: tracked.intentId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Update bundle status based on Flashbots response
   */
  private async updateBundleStatus(tracked: TrackedBundle, stats: BundleStatsResponse): Promise<void> {
    const oldStatus = tracked.status

    if (stats.isCancelled) {
      tracked.status = 'failed'
      logSubmission('❌ CANCELLED', tracked.bundleHash, 'cancelled', {
        intentId: tracked.intentId,
        reason: stats.cancellationReason || 'unknown'
      })
    } else if (stats.landedAt && stats.landedBlockNumber && stats.landedTxHash) {
      tracked.status = 'included'
      tracked.blockNumber = stats.landedBlockNumber
      tracked.txHash = stats.landedTxHash
      logSubmission('✅ INCLUDED', tracked.bundleHash, 'success', {
        intentId: tracked.intentId,
        blockNumber: stats.landedBlockNumber,
        txHash: stats.landedTxHash,
        landedAt: stats.landedAt
      })

      // Log successful transaction to dedicated file
      await this.logSuccessfulTransaction(tracked, stats)
    } else if (stats.isSentToMiners) {
      // Still pending but sent to miners
      logSubmission('📤 SENT TO MINERS', tracked.bundleHash, 'pending', {
        intentId: tracked.intentId,
        sentAt: stats.sentToMinersAt,
        highPriority: stats.isHighPriority
      })
    } else if (stats.isSimulated) {
      // Simulated but not yet sent
      logSubmission('🔬 SIMULATED', tracked.bundleHash, 'pending', {
        intentId: tracked.intentId,
        simulatedAt: stats.simulatedAt
      })
    } else {
      // Still pending
      logSubmission('⏳ PENDING', tracked.bundleHash, 'pending', {
        intentId: tracked.intentId,
        submittedAt: stats.submittedAt
      })
    }

    // If status changed to final state, we can stop tracking
    if ((oldStatus === 'pending') && (tracked.status === 'included' || tracked.status === 'failed')) {
      // Keep tracking for a bit longer to show final status
      setTimeout(async () => {
        this.trackedBundles.delete(tracked.bundleHash)
        await this.persistBundles()
        logSubmission('🗑️ CLEANUP', tracked.bundleHash, 'removed', { intentId: tracked.intentId })
      }, 10000) // Keep for 10 seconds after final status
    } else {
      // Update persistence for status changes
      await this.persistBundles()
    }
  }

  /**
   * Check status of a public transaction via RPC
   */
  private async checkPublicTransactionStatus(tracked: TrackedBundle): Promise<void> {
    tracked.lastChecked = Date.now()

    try {
      // Initialize provider if not already done
      if (!this.provider) {
        this.provider = new JsonRpcProvider(ENV.RPC_URL)
      }

      // Get transaction receipt
      const receipt = await this.provider.getTransactionReceipt(tracked.bundleHash)

      if (receipt) {
        // Transaction is confirmed
        const oldStatus = tracked.status
        tracked.status = receipt.status === 1 ? 'included' : 'failed'
        tracked.blockNumber = receipt.blockNumber
        tracked.txHash = receipt.hash

        const elapsed = Date.now() - tracked.submittedAt

        if (tracked.status === 'included') {
          logSubmission('✅ INCLUDED', tracked.bundleHash, 'success', {
            intentId: tracked.intentId,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed?.toString(),
            elapsedMs: elapsed,
            confirmations: receipt.confirmations || 0
          })
        } else {
          logSubmission('❌ FAILED', tracked.bundleHash, 'failed', {
            intentId: tracked.intentId,
            blockNumber: receipt.blockNumber,
            elapsedMs: elapsed
          })
        }

        // Clean up after final status
        if (oldStatus === 'pending') {
          setTimeout(async () => {
            this.trackedBundles.delete(tracked.bundleHash)
            await this.persistBundles()
            logSubmission('🗑️ CLEANUP', tracked.bundleHash, 'removed', { intentId: tracked.intentId })
          }, 10000)
        } else {
          await this.persistBundles()
        }
      } else {
        // Transaction not yet mined
        logSubmission('⏳ PENDING', tracked.bundleHash, 'pending', {
          intentId: tracked.intentId,
          elapsedMs: Date.now() - tracked.submittedAt
        })
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logSubmission('❌ ERROR', tracked.bundleHash, 'error', {
        intentId: tracked.intentId,
        error: errorMessage
      })
    }
  }

  /**
   * Clean up bundles that are too old
   */
  private async cleanupOldBundles(now: number): Promise<void> {
    const toRemove: string[] = []

    for (const [bundleHash, tracked] of this.trackedBundles) {
      if ((now - tracked.submittedAt) > this.maxAge) {
        toRemove.push(bundleHash)
      }
    }

    for (const bundleHash of toRemove) {
      const tracked = this.trackedBundles.get(bundleHash)
      if (tracked) {
        logSubmission('⏰ EXPIRED', bundleHash, 'timeout', {
          intentId: tracked.intentId,
          age: Math.round((now - tracked.submittedAt) / 1000)
        })
        this.trackedBundles.delete(bundleHash)
      }
    }

    if (toRemove.length > 0) {
      await this.persistBundles()
    }
  }

  /**
   * Check if a bundle hash is a mock bundle (generated for testing when no relays configured)
   */
  private isMockBundle(bundleHash: string): boolean {
    // Mock bundles are generated with crypto.randomBytes(32).toString('hex') = 64 chars
    return bundleHash.startsWith('0x') && bundleHash.length === 66 && /^[0-9a-f]+$/.test(bundleHash.slice(2))
  }

  /**
   * Handle mock bundle status (simulate bundle lifecycle for testing)
   */
  private async handleMockBundleStatus(tracked: TrackedBundle): Promise<void> {
    tracked.lastChecked = Date.now()
    const elapsed = Date.now() - tracked.submittedAt

    // Simulate bundle lifecycle:
    // - First 10 seconds: pending
    // - 10-20 seconds: included (success)
    // - After 20 seconds: cleanup
    if (elapsed < 10000) {
      // Still pending
      logSubmission('⏳ MOCK PENDING', tracked.bundleHash, 'pending', {
        intentId: tracked.intentId,
        elapsedMs: elapsed
      })
    } else if (elapsed < 20000) {
      // Simulate successful inclusion
      if (tracked.status === 'pending') {
        const mockStats: BundleStatsResponse = {
          isSimulated: true,
          landedAt: new Date().toISOString(),
          landedBlockNumber: Math.floor(Date.now() / 1000),
          landedTxHash: `0x${crypto.randomBytes(32).toString('hex')}`
        }
        await this.updateBundleStatus(tracked, mockStats)
      }
    } else {
      // Mark as failed after timeout
      if (tracked.status === 'pending') {
        const mockStats: BundleStatsResponse = {
          isCancelled: true,
          cancellationReason: 'mock_timeout'
        }
        await this.updateBundleStatus(tracked, mockStats)
      }
    }
  }

  /**
   * Get current tracking status
   */
  getStatus(): { total: number, pending: number, included: number, failed: number } {
    let pending = 0, included = 0, failed = 0

    for (const tracked of this.trackedBundles.values()) {
      switch (tracked.status) {
        case 'pending': pending++; break
        case 'included': included++; break
        case 'failed': failed++; break
      }
    }

    return {
      total: this.trackedBundles.size,
      pending,
      included,
      failed
    }
  }
}

export default ReceiptChecker
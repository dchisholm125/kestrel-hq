/**
 * ReceiptChecker - Polls Flashbots for bundle status receipts
 * Provides colorful logging for submission outcomes
 * Persists transactions to file for continuous monitoring
 */

import fs from 'fs'
import path from 'path'

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
  status: 'pending' | 'included' | 'failed' | 'unknown'
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

  constructor(relayUrl: string = 'https://relay.flashbots.net', pollInterval: number = 3000, maxAge: number = 300000) {
    this.relayUrl = relayUrl.replace(/\/$/, '')
    this.pollInterval = pollInterval
    this.maxAge = maxAge

    // Set up persistence files
    const logsDir = path.resolve(process.cwd(), '..', '..', 'kestrel-protocol-private', 'logs')
    this.persistenceFile = path.join(logsDir, 'tracked_bundles.jsonl')
    this.successLogFile = path.join(logsDir, 'SUCCESSFUL_TXs.jsonl')

    // Ensure logs directory exists
    try {
      fs.mkdirSync(logsDir, { recursive: true })
    } catch (e) {
      console.warn('[ReceiptChecker] Failed to create logs directory:', e)
    }

    // Load existing transactions on startup
    this.loadPersistedBundles()
  }

  /**
   * Load persisted bundles from file
   */
  private loadPersistedBundles(): void {
    try {
      if (fs.existsSync(this.persistenceFile)) {
        const content = fs.readFileSync(this.persistenceFile, 'utf8')
        const lines = content.trim().split('\n').filter((line: string) => line.trim())

        for (const line of lines) {
          try {
            const bundle: TrackedBundle = JSON.parse(line)
            // Only load bundles that aren't too old and aren't completed
            if (bundle.status === 'pending' && (Date.now() - bundle.submittedAt) < this.maxAge) {
              this.trackedBundles.set(bundle.bundleHash, bundle)
            }
          } catch (e) {
            console.warn('[ReceiptChecker] Failed to parse persisted bundle:', e)
          }
        }

        if (this.trackedBundles.size > 0) {
          logSubmission('📂 LOADED', `${this.trackedBundles.size} bundles`, 'from_file')
        }
      }
    } catch (e) {
      console.warn('[ReceiptChecker] Failed to load persisted bundles:', e)
    }
  }

  /**
   * Persist a bundle to file
   */
  private persistBundle(bundle: TrackedBundle): void {
    try {
      const line = JSON.stringify(bundle) + '\n'
      fs.appendFileSync(this.persistenceFile, line)
    } catch (e) {
      console.warn('[ReceiptChecker] Failed to persist bundle:', e)
    }
  }

  /**
   * Remove a bundle from the persisted file
   */
  private removePersistedBundle(bundleHash: string): void {
    try {
      if (fs.existsSync(this.persistenceFile)) {
        const content = fs.readFileSync(this.persistenceFile, 'utf8')
        const lines = content.trim().split('\n').filter((line: string) => line.trim())

        const filteredLines = lines.filter((line: string) => {
          try {
            const bundle: TrackedBundle = JSON.parse(line)
            return bundle.bundleHash !== bundleHash
          } catch {
            return false // Remove malformed lines
          }
        })

        fs.writeFileSync(this.persistenceFile, filteredLines.join('\n') + '\n')
      }
    } catch (e) {
      console.warn('[ReceiptChecker] Failed to remove persisted bundle:', e)
    }
  }

  /**
   * Log successful transaction to success file
   */
  private logSuccessfulTransaction(bundle: TrackedBundle): void {
    try {
      const successRecord = {
        timestamp: new Date().toISOString(),
        intentId: bundle.intentId,
        bundleHash: bundle.bundleHash,
        submittedAt: new Date(bundle.submittedAt).toISOString(),
        completedAt: new Date().toISOString(),
        blockNumber: bundle.blockNumber,
        txHash: bundle.txHash,
        status: 'SUCCESS'
      }

      const line = JSON.stringify(successRecord) + '\n'
      fs.appendFileSync(this.successLogFile, line)

      logSubmission('🎉 SUCCESS LOGGED', bundle.bundleHash, 'success', {
        intentId: bundle.intentId,
        blockNumber: bundle.blockNumber,
        txHash: bundle.txHash
      })
    } catch (e) {
      console.warn('[ReceiptChecker] Failed to log successful transaction:', e)
    }
  }

  /**
   * Track a newly submitted bundle
   */
  trackBundle(intentId: string, bundleHash: string): void {
    const tracked: TrackedBundle = {
      intentId,
      bundleHash,
      submittedAt: Date.now(),
      lastChecked: 0,
      status: 'pending'
    }
    this.trackedBundles.set(bundleHash, tracked)
    this.persistBundle(tracked)
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
        await this.checkBundleStatus(tracked)
      } catch (error) {
        logSubmission('❌ POLL ERROR', tracked.bundleHash, 'error', {
          intentId: tracked.intentId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // Clean up old bundles
    this.cleanupOldBundles(now)
  }

  /**
   * Check status of a specific bundle
   */
  private async checkBundleStatus(tracked: TrackedBundle): Promise<void> {
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

      this.updateBundleStatus(tracked, stats)

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
  private updateBundleStatus(tracked: TrackedBundle, stats: BundleStatsResponse): void {
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

    // If status changed to final state, handle completion
    if ((oldStatus === 'pending') && (tracked.status === 'included' || tracked.status === 'failed')) {
      // Log successful transactions to success file
      if (tracked.status === 'included') {
        this.logSuccessfulTransaction(tracked)
      }

      // Remove from persistence immediately
      this.removePersistedBundle(tracked.bundleHash)

      // Keep in memory for a bit longer to show final status, then clean up
      setTimeout(() => {
        this.trackedBundles.delete(tracked.bundleHash)
        logSubmission('🗑️ CLEANUP', tracked.bundleHash, 'removed', { intentId: tracked.intentId })
      }, 10000) // Keep for 10 seconds after final status
    }
  }

  /**
   * Clean up bundles that are too old
   */
  private cleanupOldBundles(now: number): void {
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
        this.removePersistedBundle(bundleHash)
        this.trackedBundles.delete(bundleHash)
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
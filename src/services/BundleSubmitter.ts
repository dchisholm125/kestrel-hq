import { Wallet } from 'ethers'
import { ENV } from '../config'
import FlashbotsClient from './FlashbotsClient'
import BloxrouteClient from './BloxrouteClient'

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
      if (ENV.FLASHBOTS_SIGNING_KEY && ENV.FLASHBOTS_RELAY_URL) {
        const wallet = new Wallet(ENV.FLASHBOTS_SIGNING_KEY)
        this.flashbots = new FlashbotsClient(ENV.FLASHBOTS_RELAY_URL, wallet)
      }
      if (ENV.BLOXROUTE_RELAY_URL && ENV.BLOXROUTE_AUTH) {
        this.bloxroute = new BloxrouteClient(ENV.BLOXROUTE_RELAY_URL, ENV.BLOXROUTE_AUTH)
      }
      this.initialized = true
      // eslint-disable-next-line no-console
      console.log('[BundleSubmitter] initialized', {
        hasFlashbots: !!this.flashbots,
        hasBloxroute: !!this.bloxroute
      })
    } catch (e) {
      console.error('[BundleSubmitter] init error', e)
    }
  }

  /** Submit one signed transaction to all configured relays in parallel */
  public async submitToRelays(signedTransaction: string, targetBlock?: number): Promise<void> {
    this.initIfNeeded()
    const tasks: { name: string; promise: Promise<unknown> }[] = []

    if (this.flashbots) {
      const block = targetBlock || (Math.floor(Date.now() / 1000) + 30) // placeholder block number heuristic
      tasks.push({
        name: 'Flashbots',
        promise: this.flashbots.submitBundle(signedTransaction, { targetBlockNumber: block })
      })
    }
    if (this.bloxroute) {
      tasks.push({ name: 'bloXroute', promise: this.bloxroute.submitBundle(signedTransaction) })
    }

    if (tasks.length === 0) {
      console.warn('[BundleSubmitter] no relays configured')
      return
    }

    const results = await Promise.allSettled(tasks.map(t => t.promise))
    results.forEach((res, idx) => {
      const label = tasks[idx].name
      if (res.status === 'fulfilled') {
        console.log(`[BundleSubmitter] ${label}: Success`, { result: res.value })
      } else {
        console.warn(`[BundleSubmitter] ${label}: Failed`, { error: res.reason?.message || String(res.reason) })
      }
    })
  }
}

export default BundleSubmitter

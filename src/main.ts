/*
 * Application entry point (ignition switch) for Kestrel-Protocol / GasShare Guardian
 *
 * Responsibilities:
 *  1. Initialize core singletons (NodeConnector, PendingPool, BatchingEngine)
 *  2. Start the HTTP API server (Express app)
 *  3. Wire the "new block" event -> greedy bundle creation attempt
 *  4. Provide graceful shutdown on SIGINT
 *
 * NOTE ON ADAPTATION:
 *  The specification referenced importing the Express app from './server' and a PendingPoolManager.
 *  In the current codebase, the app is exported from `index.ts` and there is a shared `pendingPool` instance
 *  (no manager class). Likewise, the `NodeConnector` exposes an internal `connect()` that is private; the
 *  constructor triggers connection automatically. We therefore:
 *    - import the app from './index'
 *    - import { pendingPool } from './services/PendingPool'
 *    - import { batchingEngine } from './services/BatchingEngine'
 *    - call `getProvider()` to ensure the initial connection is established before proceeding
 */

import http from 'http'
import app from './index'
import { ENV } from './config'
import NodeConnector from './services/NodeConnector'
import { pendingPool } from './services/PendingPool'
import { batchingEngine } from './services/BatchingEngine'

// --- Runtime state ---
let server: http.Server | null = null
let unsubscribeNewBlocks: (() => void) | null = null
let shuttingDown = false

async function start(): Promise<void> {
  console.info('[main] Starting Kestrel Protocol service...')

  // 1. Initialize / connect NodeConnector FIRST.
  const nodeConnector = NodeConnector.getInstance()
  try {
    // Wait until provider becomes available (constructor already kicked off connect logic)
    await nodeConnector.getProvider()
    console.info('[main] NodeConnector provider ready')
  } catch (e) {
    console.error('[main] Failed to establish node connection – aborting startup', e)
    process.exitCode = 1
    return
  }

  // 2. Start HTTP server
  const port = ENV.API_SERVER_PORT || ENV.PORT || 3000
  await new Promise<void>(resolve => {
    server = app.listen(port, () => {
      console.info(`[main] HTTP API listening on port ${port}`)
      resolve()
    })
  })

  // 3. Wire new block listener -> greedy bundle attempt
  try {
    unsubscribeNewBlocks = nodeConnector.subscribeToNewBlocks(async (blockNumber: number) => {
      try {
        const trades = pendingPool.getTrades()
        if (trades.length === 0) {
          console.debug('[main] New block', blockNumber, '- no trades pending')
          return
        }
        // Heuristic gas limit: use 15M (roughly an Ethereum block gas target) as an upper bound for bundle sizing.
        const MAX_GAS = 15_000_000n
        const bundle = batchingEngine.createGreedyBundle(trades as any, MAX_GAS)
        console.info('[main] Greedy bundle evaluation', {
          block: blockNumber,
            selected: bundle.trades.length,
            totalGas: bundle.totalGas.toString(),
            netProfitWei: bundle.totalNetProfitWei.toString(),
            excluded: bundle.excluded.length
        })
        // Future: invoke BundleSigner + submit path when bundle meets profitability thresholds.
      } catch (err) {
        console.error('[main] Error during bundle creation on new block', err)
      }
    })
    console.info('[main] Subscribed to new block events')
  } catch (e) {
    console.error('[main] Failed to subscribe to new blocks', e)
  }

  // 4. Graceful shutdown handling
  process.once('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
  })

  console.info('[main] Startup complete')
}

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.info(`[main] Received ${signal} – commencing graceful shutdown`)

  // Stop block subscription
  try { unsubscribeNewBlocks?.() } catch { /* ignore */ }

  // Close HTTP server
  if (server) {
    await new Promise<void>(resolve => {
      server?.close(err => {
        if (err) console.error('[main] Error closing HTTP server', err)
        else console.info('[main] HTTP server closed')
        resolve()
      })
    })
  }

  // Best-effort close of provider websocket (ethers v6 patterns)
  try {
    const provider: any = (NodeConnector as any).getInstance().provider
    const ws = provider?.websocket || provider?._websocket
    if (ws && typeof ws.close === 'function') {
      ws.close()
      console.info('[main] Closed underlying websocket connection')
    } else if (ws && typeof ws.terminate === 'function') {
      ws.terminate()
      console.info('[main] Terminated underlying websocket connection')
    }
  } catch (e) {
    console.warn('[main] Failed closing websocket', e)
  }

  console.info('[main] Shutdown complete')
  process.exit(0)
}

// Execute start when this file is run
start().catch(err => {
  console.error('[main] Unhandled startup error', err)
  process.exit(1)
})

export { start }

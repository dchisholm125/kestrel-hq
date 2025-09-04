import { ENV } from '../config'
import * as ethers from 'ethers'

/**
 * Singleton that manages a WebSocketProvider connection to a node (anvil/mainnet fork).
 * It attaches to the underlying websocket (when available) and attempts reconnects
 * with exponential backoff on errors/close events.
 */
class NodeConnector {
  private static instance: NodeConnector
  // use a permissive runtime type for provider to avoid typing mismatches across ethers versions
  public provider: any | null = null
  private retries = 0
  private maxRetries = 6
  private baseDelay = 1000 // ms
  private connecting = false

  private constructor() {
    this.connect()
  }

  /**
   * Testing hooks: allow overriding the WebSocketProvider constructor (for unit tests)
   */
  public static WebSocketProviderCtor: any = (ethers as any).WebSocketProvider

  /**
   * Reset singleton for tests
   */
  public static resetForTests() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(NodeConnector as any).instance = undefined
  }

  private attachWebSocketHandlers(provider: any) {
    // The ethers provider exposes the underlying websocket under different names in some builds.
    type WsLike = {
      on: (event: string, handler: (...args: unknown[]) => void) => void
    }

  const p = provider as unknown as Record<string, unknown>
  const wsCandidate1 = p.websocket as WsLike | undefined
  const wsCandidate2 = p._websocket as WsLike | undefined
  const ws: WsLike | null = wsCandidate1 || wsCandidate2 || null

    if (!ws) {
      // Nothing to attach to; provider may still work for HTTP/fallbacks
      return
    }

    // Attach handlers safely
    try {
      ws.on('error', (err: unknown) => {
        console.error('[NodeConnector] websocket error', err)
        this.scheduleReconnect()
      })

      ws.on('close', (...args: unknown[]) => {
        console.warn('[NodeConnector] websocket closed', { args })
        this.scheduleReconnect()
      })
    } catch (e) {
      // Defensive: some ws implementations may throw when reattaching
      console.warn('[NodeConnector] failed to attach ws handlers', e)
    }
  }

  private async connect() {
    if (this.connecting) return
    this.connecting = true

    if (!ENV.RPC_URL) {
      this.connecting = false
      throw new Error('RPC_URL is not defined in config')
    }

    try {
  // construct using overridable ctor to ease testing
  const Ctor = NodeConnector.WebSocketProviderCtor
  this.provider = new Ctor(ENV.RPC_URL)
      this.attachWebSocketHandlers(this.provider)
      this.retries = 0
      this.connecting = false
      console.info('[NodeConnector] connected to node')
    } catch (err) {
      console.error('[NodeConnector] connection failed', err)
      this.connecting = false
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.retries >= this.maxRetries) {
      console.error('[NodeConnector] max retries reached, will not reconnect')
      return
    }

    const delay = this.baseDelay * Math.pow(2, this.retries)
    this.retries += 1
    console.info(`[NodeConnector] reconnecting in ${delay}ms (attempt ${this.retries}/${this.maxRetries})`)
    setTimeout(() => this.connect(), delay)
  }

  public async getProvider(): Promise<any> {
    // Wait until provider is available or retries exhausted
    const pollInterval = 250
    const maxWait = this.baseDelay * Math.pow(2, this.maxRetries)
    let waited = 0

    while (!this.provider && waited < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval))
      waited += pollInterval
    }

    if (!this.provider) {
      throw new Error('Provider not available')
    }

    return this.provider
  }

  /**
   * Subscribe to new block events and log the block number.
   * Call this after provider is available. Returns an unsubscribe function.
   */
  /**
   * Subscribe to new block events and optionally provide a callback.
   * Returns an unsubscribe function.
   */
  public subscribeToNewBlocks(callback?: (blockNumber: number) => void): () => void {
    if (!this.provider) {
      throw new Error('Provider not initialized')
    }

    const handler = callback ?? ((blockNumber: number) => {
      console.info('[NodeConnector] new block', blockNumber)
    })

    // subscribe
    this.provider.on('block', handler)

    // return unsubscribe
    return () => {
      // best-effort unsubscribe
      try {
        this.provider?.off('block', handler)
      } catch {
        void 0
      }
    }
  }

  public static getInstance(): NodeConnector {
    if (!NodeConnector.instance) {
      NodeConnector.instance = new NodeConnector()
    }
    return NodeConnector.instance
  }
}

export default NodeConnector

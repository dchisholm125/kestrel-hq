import * as ethers from 'ethers'

/**
 * Multi-endpoint resilient connector.
 *
 * Responsibilities:
 *  - Maintain a list of HTTP (JSON-RPC) endpoints and provide a healthy provider via getProvider().
 *  - Maintain a list of WebSocket endpoints and provide a healthy streaming provider via getStreamingProvider().
 *  - Remember the last known good index for each transport so it is tried first next invocation.
 *  - Lightweight health check (eth_blockNumber) with timeout for selection.
 *  - Backwards compatibility: if constructed via getInstance() with no config, it builds config from env vars.
 */

export interface NodeConnectorConfig {
  httpUrls: string[]
  wsUrls: string[]
  healthCheckTimeoutMs?: number
}

class NodeConnector {
  private static instance: NodeConnector | undefined

  // Testing hooks (overridable)
  public static JsonRpcProviderCtor: any = (ethers as any).JsonRpcProvider || (ethers as any).providers?.JsonRpcProvider
  public static WebSocketProviderCtor: any = (ethers as any).WebSocketProvider || (ethers as any).providers?.WebSocketProvider

  // Caches for provider reuse
  private httpProviderCache = new Map<string, any>()
  private wsProviderCache = new Map<string, any>()

  // Last good indices (round-robin starting point)
  private lastGoodHttpIndex = 0
  private lastGoodWsIndex = 0

  // Active providers
  private httpProvider: any | null = null
  public provider: any | null = null // streaming provider kept for backwards compatibility (shutdown / subscribe)

  private readonly httpUrls: string[]
  private readonly wsUrls: string[]
  private readonly healthCheckTimeoutMs: number

  private resolvingHttp = false
  private resolvingWs = false

  private constructor(cfg: NodeConnectorConfig) {
    this.httpUrls = [...new Set(cfg.httpUrls.filter(u => !!u))]
    this.wsUrls = [...new Set(cfg.wsUrls.filter(u => !!u))]
    this.healthCheckTimeoutMs = cfg.healthCheckTimeoutMs ?? 2000
    if (this.httpUrls.length === 0 && this.wsUrls.length === 0) {
      throw new Error('NodeConnector requires at least one RPC or WS URL')
    }
  }

  /** Build config from environment variables (best-effort) */
  private static buildConfigFromEnv(): NodeConnectorConfig {
    const env = process.env
    const httpCandidates = [
      env.RPC_URL,
      env.INFURA_RPC_URL,
      env.ALCHEMY_RPC_URL,
      env.QUICKNODE_RPC_URL,
      env.ANVIL_RPC_URL
    ].filter(u => typeof u === 'string' && u.startsWith('http')) as string[]

    const wsExplicit = [
      env.INFURA_WS_URL,
      env.ALCHEMY_WS_URL,
      env.QUICKNODE_WS_URL,
      env.WS_RPC_URL
    ].filter(u => typeof u === 'string' && u.startsWith('ws')) as string[]

    // Derive ws URLs from http ones if none explicitly provided (heuristic)
    let wsDerived: string[] = []
    if (wsExplicit.length === 0) {
      wsDerived = httpCandidates.map(h => h.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'))
    }

    return { httpUrls: httpCandidates, wsUrls: wsExplicit.length ? wsExplicit : wsDerived }
  }

  /** Reset singleton for tests */
  public static resetForTests() {
    ;(NodeConnector as any).instance = undefined
  }

  public static getInstance(cfg?: NodeConnectorConfig): NodeConnector {
    if (!NodeConnector.instance) {
      NodeConnector.instance = new NodeConnector(cfg ?? NodeConnector.buildConfigFromEnv())
    }
    return NodeConnector.instance
  }

  /** Public for tests: expose internal caches (readonly) */
  public getCurrentHttpUrl(): string | null {
    return this.httpProvider?._network?.name ? this.httpProvider?.connection?.url ?? null : (this.httpProvider?.url ?? null)
  }

  // ---- Provider selection (HTTP) ----
  public async getProvider(): Promise<any> {
    if (this.httpProvider) return this.httpProvider
    if (this.resolvingHttp) {
      // Simple wait loop until resolution completes
      while (this.resolvingHttp) {
        await new Promise(r => setTimeout(r, 25))
      }
      if (this.httpProvider) return this.httpProvider
    }
    this.resolvingHttp = true
    try {
      const provider = await this.selectHealthyProvider(this.httpUrls, this.lastGoodHttpIndex, this.httpProviderCache, 'http')
      if (!provider) throw new Error('No healthy HTTP provider found')
      // Update last good index based on position resolved
      this.lastGoodHttpIndex = this.httpUrls.indexOf((provider as any).connection?.url || provider.url)
      this.httpProvider = provider
      return provider
    } finally {
      this.resolvingHttp = false
    }
  }

  // ---- Provider selection (WebSocket) ----
  public async getStreamingProvider(): Promise<any> {
    if (this.provider) return this.provider
    if (this.resolvingWs) {
      while (this.resolvingWs) {
        await new Promise(r => setTimeout(r, 25))
      }
      if (this.provider) return this.provider
    }
    this.resolvingWs = true
    try {
      const provider = await this.selectHealthyProvider(this.wsUrls, this.lastGoodWsIndex, this.wsProviderCache, 'ws')
      if (!provider) throw new Error('No healthy WebSocket provider found')
      this.lastGoodWsIndex = this.wsUrls.indexOf((provider as any).connection?.url || provider.url)
      // attach basic lifecycle handlers
      this.attachWebSocketHandlers(provider)
      this.provider = provider
      return provider
    } finally {
      this.resolvingWs = false
    }
  }

  /** Subscribe to new block events using (or creating) a streaming provider */
  public subscribeToNewBlocks(callback?: (blockNumber: number) => void): () => void {
    if (!this.provider) {
      // lazily initialize streaming provider
      // NOTE: synchronous because we only set provider after awaitable selection; callers wanting
      // to ensure readiness should await getStreamingProvider() first.
      const maybePromise = this.getStreamingProvider()
      // Fire and forget; for immediate subscription we chain once resolved.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      maybePromise.then(p => {
        const handler = callback ?? ((bn: number) => console.info('[NodeConnector] new block', bn))
        try { p.on('block', handler) } catch { /* ignore */ }
      })
      return () => { /* unsubscribe noop if never attached */ }
    }
    const handler = callback ?? ((bn: number) => console.info('[NodeConnector] new block', bn))
    this.provider.on('block', handler)
    return () => {
      try { this.provider?.off('block', handler) } catch { /* ignore */ }
    }
  }

  // ---- Internal selection logic ----
  private async selectHealthyProvider(urls: string[], startIndex: number, cache: Map<string, any>, kind: 'http' | 'ws'): Promise<any | null> {
    if (urls.length === 0) return null
    const order = this.buildRoundRobinOrder(urls.length, startIndex)
    for (const idx of order) {
      const url = urls[idx]
      try {
        const provider = cache.get(url) || this.instantiateProvider(url, kind)
        if (!cache.has(url)) cache.set(url, provider)
        const healthy = await this.healthCheck(provider)
        if (healthy) {
          if (kind === 'ws') console.info(`[NodeConnector] Selected WS provider ${url}`)
          else console.info(`[NodeConnector] Selected HTTP provider ${url}`)
          return provider
        }
      } catch (e) {
        console.warn(`[NodeConnector] provider failed (${url})`, (e as Error).message)
      }
    }
    return null
  }

  private buildRoundRobinOrder(length: number, start: number): number[] {
    return Array.from({ length }, (_, i) => (start + i) % length)
  }

  private instantiateProvider(url: string, kind: 'http' | 'ws'): any {
    if (kind === 'http') {
      const Ctor = NodeConnector.JsonRpcProviderCtor
      return new Ctor(url)
    } else {
      const Ctor = NodeConnector.WebSocketProviderCtor
      return new Ctor(url)
    }
  }

  private async healthCheck(provider: any): Promise<boolean> {
    const timeout = this.healthCheckTimeoutMs
    try {
      await Promise.race([
        (async () => {
          if (typeof provider.getBlockNumber === 'function') {
            await provider.getBlockNumber()
          } else if (typeof provider.send === 'function') {
            await provider.send('eth_blockNumber', [])
          } else {
            throw new Error('Provider lacks block number method')
          }
        })(),
        new Promise((_r, rej) => setTimeout(() => rej(new Error('health check timeout')), timeout))
      ])
      return true
    } catch {
      return false
    }
  }

  private attachWebSocketHandlers(provider: any) {
    type WsLike = { on: (event: string, handler: (...args: unknown[]) => void) => void }
    const p = provider as Record<string, unknown>
    const wsCandidate1 = p.websocket as WsLike | undefined
    const wsCandidate2 = p._websocket as WsLike | undefined
    const ws: WsLike | null = wsCandidate1 || wsCandidate2 || null
    if (!ws) return
    try {
      ws.on('error', (err: unknown) => {
        console.error('[NodeConnector] websocket error', err)
        // Drop current provider so next subscription fetches a new one
        this.provider = null
      })
      ws.on('close', () => {
        console.warn('[NodeConnector] websocket closed')
        this.provider = null
      })
    } catch (e) {
      console.warn('[NodeConnector] failed attaching ws handlers', e)
    }
  }
}

export default NodeConnector

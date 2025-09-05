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
    httpUrls: string[];
    wsUrls: string[];
    healthCheckTimeoutMs?: number;
}
declare class NodeConnector {
    private static instance;
    static JsonRpcProviderCtor: any;
    static WebSocketProviderCtor: any;
    private httpProviderCache;
    private wsProviderCache;
    private lastGoodHttpIndex;
    private lastGoodWsIndex;
    private httpProvider;
    provider: any | null;
    private readonly httpUrls;
    private readonly wsUrls;
    private readonly healthCheckTimeoutMs;
    private resolvingHttp;
    private resolvingWs;
    private constructor();
    /** Build config from environment variables (best-effort) */
    private static buildConfigFromEnv;
    /** Reset singleton for tests */
    static resetForTests(): void;
    static getInstance(cfg?: NodeConnectorConfig): NodeConnector;
    /** Public for tests: expose internal caches (readonly) */
    getCurrentHttpUrl(): string | null;
    getProvider(): Promise<any>;
    getStreamingProvider(): Promise<any>;
    /** Subscribe to new block events using (or creating) a streaming provider */
    subscribeToNewBlocks(callback?: (blockNumber: number) => void): () => void;
    private selectHealthyProvider;
    private buildRoundRobinOrder;
    private instantiateProvider;
    private healthCheck;
    private attachWebSocketHandlers;
}
export default NodeConnector;
//# sourceMappingURL=NodeConnector.d.ts.map
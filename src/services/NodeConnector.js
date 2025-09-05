"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const ethers = __importStar(require("ethers"));
class NodeConnector {
    constructor(cfg) {
        // Caches for provider reuse
        this.httpProviderCache = new Map();
        this.wsProviderCache = new Map();
        // Last good indices (round-robin starting point)
        this.lastGoodHttpIndex = 0;
        this.lastGoodWsIndex = 0;
        // Active providers
        this.httpProvider = null;
        this.provider = null; // streaming provider kept for backwards compatibility (shutdown / subscribe)
        this.resolvingHttp = false;
        this.resolvingWs = false;
        this.httpUrls = [...new Set(cfg.httpUrls.filter(u => !!u))];
        this.wsUrls = [...new Set(cfg.wsUrls.filter(u => !!u))];
        this.healthCheckTimeoutMs = cfg.healthCheckTimeoutMs ?? 2000;
        if (this.httpUrls.length === 0 && this.wsUrls.length === 0) {
            throw new Error('NodeConnector requires at least one RPC or WS URL');
        }
    }
    /** Build config from environment variables (best-effort) */
    static buildConfigFromEnv() {
        const env = process.env;
        const httpCandidates = [
            env.MAINNET_RPC_URL, // added to prefer explicit mainnet primary RPC
            env.RPC_URL,
            env.INFURA_RPC_URL,
            env.ALCHEMY_RPC_URL,
            env.QUICKNODE_RPC_URL,
            env.ANVIL_RPC_URL
        ].filter(u => typeof u === 'string' && u.startsWith('http'));
        const wsExplicit = [
            env.BROADCASTER_WS_URL, // added explicit broadcaster ws endpoint
            env.INFURA_WS_URL,
            env.ALCHEMY_WS_URL,
            env.QUICKNODE_WS_URL,
            env.WS_RPC_URL
        ].filter(u => typeof u === 'string' && u.startsWith('ws'));
        // Derive ws URLs from http ones if none explicitly provided (heuristic)
        let wsDerived = [];
        if (wsExplicit.length === 0) {
            wsDerived = httpCandidates.map(h => h.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'));
        }
        return { httpUrls: httpCandidates, wsUrls: wsExplicit.length ? wsExplicit : wsDerived };
    }
    /** Reset singleton for tests */
    static resetForTests() {
        ;
        NodeConnector.instance = undefined;
    }
    static getInstance(cfg) {
        if (!NodeConnector.instance) {
            NodeConnector.instance = new NodeConnector(cfg ?? NodeConnector.buildConfigFromEnv());
        }
        return NodeConnector.instance;
    }
    /** Public for tests: expose internal caches (readonly) */
    getCurrentHttpUrl() {
        return this.httpProvider?._network?.name ? this.httpProvider?.connection?.url ?? null : (this.httpProvider?.url ?? null);
    }
    // ---- Provider selection (HTTP) ----
    async getProvider() {
        if (this.httpProvider)
            return this.httpProvider;
        if (this.resolvingHttp) {
            // Simple wait loop until resolution completes
            while (this.resolvingHttp) {
                await new Promise(r => setTimeout(r, 25));
            }
            if (this.httpProvider)
                return this.httpProvider;
        }
        this.resolvingHttp = true;
        try {
            const provider = await this.selectHealthyProvider(this.httpUrls, this.lastGoodHttpIndex, this.httpProviderCache, 'http');
            if (!provider)
                throw new Error('No healthy HTTP provider found');
            // Update last good index based on position resolved
            this.lastGoodHttpIndex = this.httpUrls.indexOf(provider.connection?.url || provider.url);
            this.httpProvider = provider;
            return provider;
        }
        finally {
            this.resolvingHttp = false;
        }
    }
    // ---- Provider selection (WebSocket) ----
    async getStreamingProvider() {
        if (this.provider)
            return this.provider;
        if (this.resolvingWs) {
            while (this.resolvingWs) {
                await new Promise(r => setTimeout(r, 25));
            }
            if (this.provider)
                return this.provider;
        }
        this.resolvingWs = true;
        try {
            const provider = await this.selectHealthyProvider(this.wsUrls, this.lastGoodWsIndex, this.wsProviderCache, 'ws');
            if (!provider)
                throw new Error('No healthy WebSocket provider found');
            this.lastGoodWsIndex = this.wsUrls.indexOf(provider.connection?.url || provider.url);
            // attach basic lifecycle handlers
            this.attachWebSocketHandlers(provider);
            this.provider = provider;
            return provider;
        }
        finally {
            this.resolvingWs = false;
        }
    }
    /** Subscribe to new block events using (or creating) a streaming provider */
    subscribeToNewBlocks(callback) {
        if (!this.provider) {
            // lazily initialize streaming provider
            // NOTE: synchronous because we only set provider after awaitable selection; callers wanting
            // to ensure readiness should await getStreamingProvider() first.
            const maybePromise = this.getStreamingProvider();
            // Fire and forget; for immediate subscription we chain once resolved.
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            maybePromise.then(p => {
                const handler = callback ?? ((bn) => console.info('[NodeConnector] new block', bn));
                try {
                    p.on('block', handler);
                }
                catch { /* ignore */ }
            });
            return () => { };
        }
        const handler = callback ?? ((bn) => console.info('[NodeConnector] new block', bn));
        this.provider.on('block', handler);
        return () => {
            try {
                this.provider?.off('block', handler);
            }
            catch { /* ignore */ }
        };
    }
    // ---- Internal selection logic ----
    async selectHealthyProvider(urls, startIndex, cache, kind) {
        if (urls.length === 0)
            return null;
        const order = this.buildRoundRobinOrder(urls.length, startIndex);
        for (const idx of order) {
            const url = urls[idx];
            try {
                const provider = cache.get(url) || this.instantiateProvider(url, kind);
                if (!cache.has(url))
                    cache.set(url, provider);
                const healthy = await this.healthCheck(provider);
                if (healthy) {
                    if (kind === 'ws')
                        console.info(`[NodeConnector] Selected WS provider ${url}`);
                    else
                        console.info(`[NodeConnector] Selected HTTP provider ${url}`);
                    return provider;
                }
            }
            catch (e) {
                console.warn(`[NodeConnector] provider failed (${url})`, e.message);
            }
        }
        return null;
    }
    buildRoundRobinOrder(length, start) {
        return Array.from({ length }, (_, i) => (start + i) % length);
    }
    instantiateProvider(url, kind) {
        if (kind === 'http') {
            const Ctor = NodeConnector.JsonRpcProviderCtor;
            return new Ctor(url);
        }
        else {
            const Ctor = NodeConnector.WebSocketProviderCtor;
            return new Ctor(url);
        }
    }
    async healthCheck(provider) {
        const timeout = this.healthCheckTimeoutMs;
        try {
            await Promise.race([
                (async () => {
                    if (typeof provider.getBlockNumber === 'function') {
                        await provider.getBlockNumber();
                    }
                    else if (typeof provider.send === 'function') {
                        await provider.send('eth_blockNumber', []);
                    }
                    else {
                        throw new Error('Provider lacks block number method');
                    }
                })(),
                new Promise((_r, rej) => setTimeout(() => rej(new Error('health check timeout')), timeout))
            ]);
            return true;
        }
        catch {
            return false;
        }
    }
    attachWebSocketHandlers(provider) {
        const p = provider;
        const wsCandidate1 = p.websocket;
        const wsCandidate2 = p._websocket;
        const ws = wsCandidate1 || wsCandidate2 || null;
        if (!ws)
            return;
        try {
            ws.on('error', (err) => {
                console.error('[NodeConnector] websocket error', err);
                // Drop current provider so next subscription fetches a new one
                this.provider = null;
            });
            ws.on('close', () => {
                console.warn('[NodeConnector] websocket closed');
                this.provider = null;
            });
        }
        catch (e) {
            console.warn('[NodeConnector] failed attaching ws handlers', e);
        }
    }
}
// Testing hooks (overridable)
NodeConnector.JsonRpcProviderCtor = ethers.JsonRpcProvider || ethers.providers?.JsonRpcProvider;
NodeConnector.WebSocketProviderCtor = ethers.WebSocketProvider || ethers.providers?.WebSocketProvider;
exports.default = NodeConnector;

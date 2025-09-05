import { EventEmitter } from 'events';
import { WebSocketProvider } from 'ethers';

export type OnChainScannerEvents =
  | { type: 'newBlock'; blockNumber: number }
  | { type: 'pendingTransaction'; txHash: string }
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: any }
  | { type: 'error'; error: Error }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'reconnected'; attempt: number };

interface ConnectionState {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  attempts: number;
  url?: string;
}

/**
 * OnChainScanner is a singleton responsible for listening to chain events
 * (new blocks and pending transactions) and re-emitting them in a typed, SDK-friendly way.
 */
export class OnChainScanner extends EventEmitter {
  private static _instance: OnChainScanner;
  private provider?: WebSocketProvider; // Ethers v6 WebSocketProvider
  private state: ConnectionState = { status: 'idle', attempts: 0 };
  private reconnectTimer?: NodeJS.Timeout;
  private destroyed = false;
  private maxReconnectDelayMs = 30_000;
  private baseReconnectDelayMs = 1_000;

  private constructor() {
    super();
  }

  public static get instance(): OnChainScanner {
    if (!this._instance) {
      this._instance = new OnChainScanner();
    }
    return this._instance;
  }

  /**
   * Connect to a websocket endpoint. If already connected to same URL, no-op.
   */
  public async connect(url: string): Promise<void> {
    console.log('[OnChainScanner] connect called with URL:', url)
    if (this.destroyed) {
      console.log('[OnChainScanner] destroyed, throwing error')
      throw new Error('OnChainScanner has been destroyed');
    }
    if (this.provider && this.state.status === 'connected' && this.state.url === url) {
      console.log('[OnChainScanner] already connected to same URL, returning early')
      return; // already connected
    }

    console.log('[OnChainScanner] calling establishConnection')
    await this.establishConnection(url);
  }

  private async establishConnection(url: string) {
    console.log('[OnChainScanner] establishConnection called with URL:', url)
    this.cleanupProvider();
    this.state = { status: 'connecting', attempts: 0, url };

    return new Promise<void>((resolve, reject) => {
      try {
        // Check if this is our custom broadcaster URL
        console.log('[OnChainScanner] Checking URL:', url)
        if (url.includes('127.0.0.1:8546') || url.includes('localhost:8546')) {
          console.log('[OnChainScanner] Using custom broadcaster WebSocket connection')
          // Use WebSocket directly for our custom broadcaster
          try {
            const WebSocket = require('ws');
            const ws = new WebSocket(url);

            ws.on('open', () => {
              console.log('[OnChainScanner] WebSocket connected to broadcaster');
              this.state.status = 'connected';
              this.emit('connected');
              resolve();
            });

            ws.on('message', (data: Buffer) => {
              try {
                const message = JSON.parse(data.toString());
                console.log('[OnChainScanner] received message:', message.type)
                if (message.type === 'block') {
                  console.log('[OnChainScanner] emitting newBlock:', message.blockNumber)
                  this.emit('newBlock', message.blockNumber);
                } else if (message.type === 'pending') {
                  console.log('[OnChainScanner] emitting pendingTransaction:', message.txHash)
                  this.emit('pendingTransaction', message.txHash);
                }
              } catch (err) {
                console.error('[OnChainScanner] error parsing message:', err)
              }
            });

            ws.on('close', () => {
              console.log('[OnChainScanner] WebSocket closed')
              this.handleDisconnect();
            });

            ws.on('error', (err: any) => {
              console.error('[OnChainScanner] WebSocket error:', err.message);
              this.emit('error', new Error('WebSocket error'));
              this.handleDisconnect(err);
              reject(err);
            });

          } catch (err) {
            console.error('[OnChainScanner] failed to load ws package:', err);
            reject(new Error('ws package not available'));
          }
        } else {
          console.log('[OnChainScanner] Using standard WebSocketProvider for URL:', url)
          // Use standard WebSocketProvider for real Ethereum nodes
          this.provider = new WebSocketProvider(url);
          // attach listeners
          this.provider.on('block', (blockNumber: number) => {
            this.emit('newBlock', blockNumber);
          });

          this.provider.on('pending', (txHash: string) => {
            this.emit('pendingTransaction', txHash);
          });

          // Ethers v6: provider._websocket may not be public; we rely on events for error/close.
          // We'll attach generic listeners if available (best-effort) for disconnect detection.
          // @ts-ignore - accessing internal
          const ws = (this.provider as any)._websocket as WebSocket | undefined;
          if (ws) {
            ws.addEventListener('close', (ev: any) => {
              this.handleDisconnect(ev);
            });
            ws.addEventListener('error', (err: any) => {
              this.emit('error', new Error('WebSocket error')); // propagate generic error
              this.handleDisconnect(err);
            });
            ws.addEventListener('open', () => {
              this.state.status = 'connected';
              this.emit('connected');
            });
          } else {
            // If we can't hook into low-level ws, assume immediate success after first call to get block number
            this.state.status = 'connected';
            this.emit('connected');
          }

          // Probe connectivity (optional): fetch current block number; if fails triggers catch
          this.provider.getBlockNumber().then(() => {
            if (this.state.status !== 'connected') {
              this.state.status = 'connected';
              this.emit('connected');
            }
            resolve();
          }).catch((err) => {
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
            this.handleDisconnect(err);
            reject(err);
          });
        }
      } catch (err: any) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        this.handleDisconnect(err);
        reject(err);
      }
    });
  }

  /** Gracefully disconnect and stop any reconnection attempts. */
  public async destroy(): Promise<void> {
    this.destroyed = true;
    this.clearReconnectTimer();
    await this.closeProvider();
    this.state.status = 'disconnected';
    this.emit('disconnected');
  }

  /** Lightweight graceful provider close preferring provider.destroy() if present */
  private async closeProvider(timeoutMs = 2000): Promise<void> {
    if (!this.provider) return;
    const p = this.provider;
    try {
      // prefer provider.destroy() if implemented by ethers provider
      const maybeDestroy = (p as any).destroy;
      if (typeof maybeDestroy === 'function') {
        try { await maybeDestroy.call(p); } catch (_) {}
        this.provider = undefined;
        return;
      }

      // otherwise perform a measured close: remove listeners, close/terminate ws, wait for close
      try { p.removeAllListeners(); } catch (_) {}
      // @ts-ignore
      const ws = (p as any)._websocket as any | undefined;
      if (ws) {
        let closed = false;
        const onClose = () => { closed = true; };
        try { ws.addEventListener && ws.addEventListener('close', onClose); } catch (_) {}
        try { ws.onclose = onClose; } catch (_) {}
        try {
          if (typeof ws.terminate === 'function') ws.terminate();
          else if (typeof ws.close === 'function') ws.close();
        } catch (_) {}

        const start = Date.now();
        while (!closed && Date.now() - start < timeoutMs) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    } catch (_) {
      // ignore
    } finally {
      try { p.removeAllListeners(); } catch (_) {}
      this.provider = undefined;
    }
  }

  private cleanupProvider() {
    if (this.provider) {
      try {
        // remove high-level ethers listeners and close underlying socket if possible
        try { this.provider.removeAllListeners(); } catch (_) {}
        // @ts-ignore internal websocket
        const ws = (this.provider as any)._websocket as any | undefined;
        if (ws) {
          try {
            if (typeof ws.terminate === 'function') ws.terminate();
            else if (typeof ws.close === 'function') ws.close();
          } catch (_) {}
        }
      } catch (_) {
        // ignore
      }
    }
    this.provider = undefined;
  }

  private handleDisconnect(reason?: any) {
    if (this.destroyed) return;
    if (this.state.status === 'reconnecting') return; // already handling
    this.emit('disconnected', reason);
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.state.url) return;
    this.state.status = 'reconnecting';
    const attempt = ++this.state.attempts;
    const delay = Math.min(this.baseReconnectDelayMs * 2 ** (attempt - 1), this.maxReconnectDelayMs);
    this.emit('reconnecting', attempt);
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(async () => {
      if (this.destroyed) return;
      try {
        await this.establishConnection(this.state.url!);
        this.emit('reconnected', attempt);
      } catch (err) {
        // failure will cascade to another schedule
      }
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

export default OnChainScanner.instance;

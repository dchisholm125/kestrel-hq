import crypto from 'crypto';
import fetch from 'node-fetch';
import {
  SubmitIntent,
  SubmitResp,
  StatusResp,
  ErrorResp,
} from './types';

export type SDKConfig = {
  baseUrl: string;
  apiKey: string;
  apiSecret: string; // used for HMAC signature
  clockSkewMs?: number; // allowed clock skew when generating timestamp
};

function hmacSignature(secret: string, data: string) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function canonicalize(obj: unknown): string {
  if (obj === null) return 'null'
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']'
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize((obj as any)[k])).join(',') + '}'
}

export class ProtocolSDK {
  private cfg: SDKConfig;

  constructor(cfg: SDKConfig) {
    this.cfg = cfg;
  }

  private makeHeaders(body?: string | object, idempotencyKey?: string) {
    const ts = Date.now().toString();
    const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : ''
    const bodySha = crypto.createHash('sha256').update(bodyString).digest('hex')
    const payload = [this.cfg.apiKey, ts, bodySha].join(':')
    const sig = hmacSignature(this.cfg.apiSecret, payload)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Kestrel-ApiKey': this.cfg.apiKey,
      'X-Kestrel-Timestamp': ts,
      'X-Kestrel-Signature': sig,
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return headers;
  }

  async submitIntent(intent: SubmitIntent, opts?: { idempotencyKey?: string }) {
    const body = JSON.stringify(intent);
    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/v1/submit-intent`, {
      method: 'POST',
      headers: this.makeHeaders(body, opts?.idempotencyKey),
      body,
    });
    const text = await res.text();
    try {
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) {
        // Expect server to return canonical ErrorEnvelope for failures
        return { ok: false, error: json } as any;
      }
      return { ok: true, intent_id: (json as any).intent_id, state: (json as any).state } as any;
    } catch (e) {
      throw new Error(`Invalid JSON response: ${e}`);
    }
  }

  async status(intent_id: string) {
    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/v1/status/${encodeURIComponent(intent_id)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await res.json();
    if (!res.ok) throw (json as ErrorResp);
    return json as StatusResp;
  }
}

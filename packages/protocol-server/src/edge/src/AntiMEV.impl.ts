/**
 * AntiMEVImpl v0
 * Purpose: Apply deterministic, bounded protections to a BundlePlan.
 * Safety bounds: never breach deadline, do not modify gasPolicy caps, do not change atomicity.
 * Determinism: salts and jitter are derived from stable inputs and an epoch bucket.
 */

import { promises as fs } from 'node:fs';

export type TxTemplate = { kind: string; [k: string]: any };
export type BundlePlan = {
  txTemplates: TxTemplate[];
  gasPolicy?: { priorityFee?: number; [k: string]: any };
  replacementPolicy?: { maxBumps?: number; bumpStep?: number; bumpCap?: number };
  deadline: number; // ms epoch
  atomic?: boolean;
  notBefore?: number; // optional start time hint (ms epoch)
};

export type AntiMEVOpts = { intentId: string; corrId?: string; now?: number };

function toHex32(n: number): string { return (n >>> 0).toString(16).padStart(8, '0'); }
function fnv1a32(str: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function deriveSaltHex(intentId: string, corrId: string, epochBucket: number): string {
  // Compose a deterministic key and hash to 128-bit hex (by combining four 32-bit hashes)
  const p1 = fnv1a32(intentId);
  const p2 = fnv1a32(corrId);
  const p3 = fnv1a32(String(epochBucket));
  const p4 = fnv1a32(`${intentId}:${corrId}:${epochBucket}`);
  return '0x' + toHex32(p1) + toHex32(p2) + toHex32(p3) + toHex32(p4);
}

function boundedJitterMs(seedHex: string, maxJitter: number): number {
  if (!maxJitter || maxJitter <= 0) return 0;
  // Use low 16 bits as pseudo-random value in [-max, +max]
  const low = parseInt(seedHex.slice(-4), 16);
  const unit = (low / 0xffff) * 2 - 1; // [-1, +1]
  return Math.round(unit * maxJitter);
}

export class AntiMEVImpl {
  private cfg: { jitterMaxMs: number; epochMs: number; decoyPct: number } = {
    jitterMaxMs: Math.max(0, Number(process.env.ANTIMEV_JITTER_MS_MAX ?? 0)),
    epochMs: Math.max(1000, Number(process.env.ANTIMEV_EPOCH_MS ?? 5000)),
    decoyPct: Math.max(0, Number(process.env.ANTIMEV_DECOY_PCT ?? 0))
  };
  // Optional hot config hook
  attachConfig(daemon: { onUpdate: (h: (e: any)=>void) => void; get: () => any }) {
    const apply = (c: any) => {
      const old = { ...this.cfg };
      const next = c?.antimev || {};
      if (typeof next.jitterMaxMs === 'number') this.cfg.jitterMaxMs = Math.max(0, next.jitterMaxMs);
      if (typeof next.epochMs === 'number') this.cfg.epochMs = Math.max(1000, next.epochMs);
      if (typeof next.decoyPct === 'number') this.cfg.decoyPct = Math.max(0, next.decoyPct);
      if (JSON.stringify(old) !== JSON.stringify(this.cfg)) {
        console.info(`config: updated antimev=${JSON.stringify(this.cfg)}`);
      }
    };
    try { apply(daemon.get()); } catch {}
    daemon.onUpdate(()=> apply(daemon.get()));
  }
  /**
   * mitigate(): mutate plan deterministically with salt and bounded jitter. Decoys are off by default.
   * - Epoch bucket hashing keeps salts deterministic within a short window while varying over time.
   * - Jitter rationale: slightly shifts timing to reduce predictability; capped by env and deadline.
   * - Decoys default off to avoid extra gas/complexity; code path is guarded by env flags.
   */
  mitigate(plan: BundlePlan, opts: AntiMEVOpts): BundlePlan {
    const now = opts.now ?? Date.now();
  const epochMs = this.cfg.epochMs;
    const bucket = Math.floor(now / epochMs);
    const intentId = opts.intentId;
    const corrId = opts.corrId ?? intentId;

    const salt = deriveSaltHex(intentId, corrId, bucket);

    // Clone and apply salt on non-critical template metadata
    const txTemplates = (plan.txTemplates || []).map(t => ({ ...t, meta: { ...(t as any).meta, salt } }));

    // Timing jitter: bounded and never past deadline
  const maxJ = this.cfg.jitterMaxMs;
    let jitter = boundedJitterMs(salt, maxJ); // may be negative
    const targetTime = now + Math.max(0, jitter); // we never move earlier than "now" in this pipeline
    const cappedNotBefore = Math.min(targetTime, Math.max(0, plan.deadline - 1));

    // Decoys (off by default)
  const decoyPct = this.cfg.decoyPct;
    let decoy = false;
    let txsWithDecoys = txTemplates;
    if (decoyPct > 0) {
      const count = Math.min(2, Math.floor((txTemplates.length || 1) * decoyPct));
      if (count > 0) {
        decoy = true;
        const decoys = new Array(count).fill(0).map((_, i) => ({ kind: 'decoy', meta: { salt, i } }));
        txsWithDecoys = [...txTemplates, ...decoys];
      }
    }

    const out: BundlePlan = { ...plan, txTemplates: txsWithDecoys, notBefore: cappedNotBefore };

    // Observability
    const jitterMs = Math.max(0, cappedNotBefore - now);
    console.info(`[antiMEV] salt=${salt} jitter=${jitterMs}ms decoy=${decoy}`);
    const rec = { ts: new Date().toISOString(), intent_id: intentId, corr_id: corrId, actions: { salt, jitter_ms: jitterMs, decoy } };
    fs.mkdir('logs', { recursive: true }).catch(() => void 0).then(() => fs.appendFile('logs/antimev.jsonl', JSON.stringify(rec) + '\n')).catch(() => void 0);

    return out;
  }
}

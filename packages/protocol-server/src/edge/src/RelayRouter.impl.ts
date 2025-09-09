/**
 * RelayRouterImpl
 * Purpose: Select relays/builders for a given BundlePlan, applying health filtering,
 * auth preference, and resilience via exponential backoff and jitter.
 * Selection criteria: exclude degraded lanes, prefer authenticated, fair ordering.
 * Latency budget: <50ms per routing decision.
 */

import { promises as fs } from 'node:fs';
// Health snapshot is provided in the lane objects (healthy flag). Router will exclude degraded lanes by default.

type BundlePlan = {
  atomic: boolean;
  deadline: number;
};

export type LaneStat = {
  id: string;            // lane/relay identifier
  url?: string;
  healthy: boolean;      // from health checks
  authenticated: boolean;// whether we have a usable key configured
  rttMs?: number;        // latency metric
  score?: number;        // composite priority score (higher is better)
};

export type RelayPlan = {
  targets: string[];          // ordered list of lane IDs
  strategy: 'parallel-prefer-auth' | 'sequential-prefer-auth';
  backoff: number[];          // per attempt backoff in ms
  jitter: number[];           // jitter applied per attempt in ms
};

function getEnvNum(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function computeBackoffSeries(attempts: number, params?: { base: number; factor: number; max: number; jitterPct: number }): { backoff: number[]; jitter: number[] } {
  const base = params?.base ?? getEnvNum('EDGE_BACKOFF_BASE_MS', 250);
  const factor = params?.factor ?? getEnvNum('EDGE_BACKOFF_FACTOR', 2);
  const max = params?.max ?? getEnvNum('EDGE_BACKOFF_MAX_MS', 8000);
  const jitterPct = Math.min(100, Math.max(0, params?.jitterPct ?? getEnvNum('EDGE_JITTER_PCT', 20)));
  const backoff: number[] = [];
  const jitter: number[] = [];
  for (let i = 0; i < attempts; i++) {
    const b = Math.min(max, Math.floor(base * Math.pow(factor, i)));
    const j = Math.floor(b * (Math.random() * (jitterPct / 100)));
    backoff.push(b);
    jitter.push(j);
  }
  return { backoff, jitter };
}

export class RelayRouterImpl {
  private cfg: { base: number; factor: number; max: number; jitterPct: number } = {
    base: getEnvNum('EDGE_BACKOFF_BASE_MS', 250),
    factor: getEnvNum('EDGE_BACKOFF_FACTOR', 2),
    max: getEnvNum('EDGE_BACKOFF_MAX_MS', 8000),
    jitterPct: getEnvNum('EDGE_JITTER_PCT', 20),
  };
  attachConfig(daemon: { onUpdate: (h: (e: any)=>void) => void; get: () => any }) {
    const apply = (c: any) => {
      const r = c?.router || {};
      const old = { ...this.cfg };
      if (typeof r.baseMs === 'number') this.cfg.base = r.baseMs;
      if (typeof r.factor === 'number') this.cfg.factor = r.factor;
      if (typeof r.maxMs === 'number') this.cfg.max = r.maxMs;
      if (typeof r.jitterPct === 'number') this.cfg.jitterPct = Math.min(100, Math.max(0, r.jitterPct));
      if (JSON.stringify(old) !== JSON.stringify(this.cfg)) {
        console.info(`config: updated router=${JSON.stringify(this.cfg)}`);
      }
    };
    try { apply(daemon.get()); } catch {}
    daemon.onUpdate(()=> apply(daemon.get()));
  }
  /**
   * Build a RelayPlan using lane stats and the bundle plan characteristics.
   * We prefer authenticated lanes to leverage private orderflow and QoS.
   * Backoff+jitter reduce thundering herd and enable resilience under load.
   */
  route(bundle: BundlePlan, lanes: LaneStat[]): RelayPlan {
  // Healthy lanes are those not marked degraded by the health daemon input (healthy=true)
  const healthy = lanes.filter(l => l.healthy);
  const degraded = lanes.filter(l => !l.healthy);

    // Prefer authenticated lanes first, then unauth; sort by score desc, then lowest rtt.
    const auth = healthy.filter(l => l.authenticated)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.rttMs ?? 1e9) - (b.rttMs ?? 1e9));
    const unauth = healthy.filter(l => !l.authenticated)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.rttMs ?? 1e9) - (b.rttMs ?? 1e9));

    const ordered = [...auth, ...unauth];
    const targets = ordered.map(l => l.id);
    // Fallback: if none healthy, attempt degraded by score anyway
    if (targets.length === 0 && degraded.length) {
      degraded.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      targets.push(...degraded.map(l => l.id));
    }

    const attempts = Math.max(1, targets.length);
  const { backoff, jitter } = computeBackoffSeries(attempts, this.cfg);
    const strategy: RelayPlan['strategy'] = bundle.atomic ? 'parallel-prefer-auth' : 'sequential-prefer-auth';

    const plan: RelayPlan = { targets, strategy, backoff, jitter };

    // Observability: console summary
    console.info('[edge][RelayRouter] plan', {
      targets,
      strategy,
      attempts,
      firstBackoffMs: backoff[0],
    });

    // Audit log
    const rec = {
      ts: new Date().toISOString(),
      corr_id: null,
      intent_id: null,
      plan,
    };
    fs.mkdir('logs', { recursive: true }).catch(() => void 0).then(() =>
      fs.appendFile('logs/relay-plans.jsonl', JSON.stringify(rec) + '\n')
    ).catch(() => void 0);

    return plan;
  }
}

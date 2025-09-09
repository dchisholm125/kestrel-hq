/**
 * CapitalPolicyImpl v0
 * Purpose: Enforce per-strategy/account caps, daily loss cap, and a kill switch before submission.
 * Precedence (fail-closed): kill → dailyLoss → caps. Do not attempt submission if denied.
 * Note: EV and fee estimates are not used in v0 but reserved for future marginal decisions.
 */

import { promises as fs } from 'node:fs';

export type IntentCtx = {
  intentId: string;
  strategyId: string;
  account: string;
  notional: number; // units of currency (e.g., USD-equivalent or native)
};

export type SimCtx = { ev?: number; gasFeeWei?: number };

export type PrecheckResult = { allow: boolean; reason?: string; limits: { cap: number; dailyLossCap: number; used: number } };

function numEnv(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}

function todayKey(ts = Date.now()): string { return new Date(ts).toISOString().slice(0, 10); }

export class CapitalPolicyImpl {
  private lossesByDay = new Map<string, number>();
  private usageAccount = new Map<string, number>();
  private usageStrategy = new Map<string, number>();
  private hot?: { kill?: boolean; accountCap?: number; strategyCap?: number; dailyLossCap?: number };
  private metrics?: { capsDenied: { inc: (labels?: Record<string,string>, v?: number) => void } };

  attachConfig(daemon: { onUpdate: (h: (e: any)=>void) => void; get: () => any }) {
    const apply = (c: any) => { this.hot = c?.capital || this.hot; };
    try { apply(daemon.get()); } catch {}
    daemon.onUpdate(()=> apply(daemon.get()));
  }

  /**
   * precheck(): Returns allow/deny and current limits snapshot.
   * Ordering: kill → dailyLoss → per-account cap → per-strategy cap.
   */
  precheck(ctx: IntentCtx, sim?: SimCtx): PrecheckResult {
  const kill = this.hot?.kill ?? (String(process.env.CAP_POLICY_KILL || '0') === '1');
  const accCap = this.hot?.accountCap ?? numEnv('CAP_POLICY_ACCOUNT_CAP', Number.POSITIVE_INFINITY);
  const stratCap = this.hot?.strategyCap ?? numEnv('CAP_POLICY_STRATEGY_CAP', Number.POSITIVE_INFINITY);
  const dailyLossCap = this.hot?.dailyLossCap ?? numEnv('CAP_POLICY_DAILY_LOSS_CAP', Number.POSITIVE_INFINITY);

    const day = todayKey();
    const lossUsed = this.lossesByDay.get(day) || 0;
    const accountUsed = this.usageAccount.get(ctx.account) || 0;
    const strategyUsed = this.usageStrategy.get(ctx.strategyId) || 0;

    let allow = true;
    let reason: string | undefined;

    if (kill) { allow = false; reason = 'kill_switch'; }
    else if (lossUsed >= dailyLossCap) { allow = false; reason = 'dailyLossCap'; }
    else if (accountUsed + ctx.notional > accCap) { allow = false; reason = 'accountCap'; }
    else if (strategyUsed + ctx.notional > stratCap) { allow = false; reason = 'strategyCap'; }

    const limits = { cap: Math.min(accCap, stratCap), dailyLossCap, used: Math.max(accountUsed, strategyUsed, lossUsed) };

    // Observability
    console.info(`[capital] ${allow ? 'ALLOW' : 'DENY'} used=${limits.used} cap=${limits.cap} loss=${lossUsed}/${dailyLossCap}${reason ? ' reason=' + reason : ''}`);
    const rec = { ts: new Date().toISOString(), intent_id: ctx.intentId, strategy: ctx.strategyId, account: ctx.account, allow, limits, reason };
    fs.mkdir('logs', { recursive: true }).catch(() => void 0).then(() => fs.appendFile('logs/capital.jsonl', JSON.stringify(rec) + '\n')).catch(() => void 0);

    // Metrics: increment denial reasons (bounded set)
    if (!allow && reason) {
      try { this.metrics?.capsDenied.inc({ reason }); } catch {}
    }

    return { allow, reason, limits };
  }

  /** Optional: update loss snapshot (could be called post-trade). */
  updateLoss(amount: number) {
    const day = todayKey();
    const prev = this.lossesByDay.get(day) || 0;
    const next = Math.max(0, prev + amount);
    this.lossesByDay.set(day, next);
    fs.mkdir('logs', { recursive: true }).catch(() => void 0).then(() => fs.appendFile('logs/capital.jsonl', JSON.stringify({ ts: new Date().toISOString(), kind: 'loss_update', day, loss: next }) + '\n')).catch(() => void 0);
  }

  /** Optional: update notional usage counters (for long-running positions). */
  updateUsage(account: string, strategyId: string, deltaNotional: number) {
    const au = (this.usageAccount.get(account) || 0) + deltaNotional; this.usageAccount.set(account, Math.max(0, au));
    const su = (this.usageStrategy.get(strategyId) || 0) + deltaNotional; this.usageStrategy.set(strategyId, Math.max(0, su));
    fs.mkdir('logs', { recursive: true }).catch(() => void 0).then(() => fs.appendFile('logs/capital.jsonl', JSON.stringify({ ts: new Date().toISOString(), kind: 'usage_update', account, strategyId, accountUsed: this.usageAccount.get(account), strategyUsed: this.usageStrategy.get(strategyId) }) + '\n')).catch(() => void 0);
  }

  // Optional: attach metrics registry
  attachMetrics(metrics: { capsDenied: { inc: (labels?: Record<string,string>, v?: number) => void } }) {
    this.metrics = metrics;
  }
}

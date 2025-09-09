/**
 * BundleAssemblerImpl
 * Purpose: Convert a validated intent + simulation outputs into a BundlePlan
 * Public contract: matches the public BundleAssembler interface from kestrel-hq.
 * Latency budget: <100ms per plan, no network I/O.
 */

import { promises as fs } from 'node:fs';

// NOTE: Replace these with real imports from @kestrel-hq/protocol-sdk when available
// import type { BundleAssembler } from '@kestrel-hq/protocol-sdk/edge/interfaces/BundleAssembler';

type TxTemplate = {
  kind: 'buy' | 'sell' | 'settle' | string;
  to: string;
  data: string;
  value?: string; // hex wei
  atomic?: boolean;
};

type GasPolicy = {
  baseFeeMax: number; // wei or gwei units depend on environment contract; treat as numeric for now
  priorityFee: number; // tip
  bumpStep: number; // per replacement increment
  bumpCap: number; // absolute cap
};

type ReplacementPolicy = {
  nonce: number;
  maxBumps: number;
  bumpStep: number;
  bumpCap: number;
};

export type BundlePlan = {
  txTemplates: TxTemplate[];
  gasPolicy: GasPolicy;
  replacementPolicy: ReplacementPolicy;
  deadline: number; // epoch ms
  atomic: boolean;
};

type NormalizedIntent = {
  id: string;
  corrId?: string;
  atomic?: boolean;
  // Minimal representation used for ordering decision
  actions: Array<{
    kind: 'buy' | 'sell' | 'settle' | string;
    to: string;
    data: string;
    value?: string;
  }>;
  // May include suggested nonce
  nonce?: number;
};

type SimOutputs = Record<string, unknown>;

const ORDER_PRIORITY: Record<string, number> = {
  buy: 0,
  sell: 1,
  settle: 2,
};

function getEnvNum(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function computeDeadlineMs(): number {
  const secs = getEnvNum('EDGE_DEADLINE_SECS', 120);
  return Date.now() + secs * 1000;
}

function computeGasPolicy(): GasPolicy {
  const baseFeeMax = getEnvNum('EDGE_BASE_FEE_MAX', 0); // interpret by your runner
  const priorityFee = getEnvNum('EDGE_BASE_TIP', 1500000000); // default 1.5 gwei in wei
  const bumpStep = getEnvNum('EDGE_GAS_BUMP_STEP', 150000000); // default 0.15 gwei
  const bumpCap = getEnvNum('EDGE_GAS_BUMP_CAP', 5000000000); // default 5 gwei cap
  // Ensure bumpStep <= bumpCap
  const safeStep = Math.min(bumpStep, bumpCap);
  return { baseFeeMax, priorityFee, bumpStep: safeStep, bumpCap };
}

function computeReplacementPolicy(nonce?: number): ReplacementPolicy {
  const maxBumps = getEnvNum('EDGE_MAX_BUMPS', 6);
  const bumpStep = getEnvNum('EDGE_GAS_BUMP_STEP', 150000000);
  const bumpCap = getEnvNum('EDGE_GAS_BUMP_CAP', 5000000000);
  return {
    nonce: nonce ?? 0,
    maxBumps,
    bumpStep: Math.min(bumpStep, bumpCap),
    bumpCap,
  };
}

function orderTxs(actions: NormalizedIntent['actions'], atomic: boolean): TxTemplate[] {
  // Deterministic ordering buy→sell→settle, then lexicographic by kind as fallback.
  return [...actions]
    .sort((a, b) => {
      const pa = ORDER_PRIORITY[a.kind] ?? 99;
      const pb = ORDER_PRIORITY[b.kind] ?? 99;
      return pa === pb ? a.kind.localeCompare(b.kind) : pa - pb;
    })
    .map(a => ({ kind: a.kind, to: a.to, data: a.data, value: a.value, atomic }));
}

export class BundleAssemblerImpl {
  /**
   * Build a BundlePlan from normalized intent and sim outputs.
   * Rationale for ordering: executing buy before sell reduces inventory risk
   * and settle last finalizes account state. Replacement math: linear tip bump
   * per replacement with a cap to avoid runaway fees.
   */
  plan(intent: NormalizedIntent, sim: SimOutputs): BundlePlan {
    const atomic = Boolean(intent.atomic ?? true);
    const txTemplates = orderTxs(intent.actions, atomic);
    const gasPolicy = computeGasPolicy();
    const replacementPolicy = computeReplacementPolicy(intent.nonce);
    // Ensure bump policy never exceeds cap
    replacementPolicy.bumpStep = Math.min(replacementPolicy.bumpStep, replacementPolicy.bumpCap);
    const deadline = computeDeadlineMs();

    const plan: BundlePlan = {
      txTemplates,
      gasPolicy,
      replacementPolicy,
      deadline,
      atomic,
    };

    // Observability: console summary
    console.info('[edge][BundleAssembler] plan', {
      intentId: intent.id,
      corrId: intent.corrId,
      txs: txTemplates.length,
      atomic,
      deadline,
      bump: { step: replacementPolicy.bumpStep, cap: replacementPolicy.bumpCap, max: replacementPolicy.maxBumps },
    });

    // Persistent audit log
    const rec = {
      ts: new Date().toISOString(),
      corr_id: intent.corrId ?? null,
      intent_id: intent.id,
      plan,
    };
    fs.mkdir('logs', { recursive: true }).catch(() => void 0).then(() =>
      fs.appendFile('logs/bundle-plans.jsonl', JSON.stringify(rec) + '\n')
    ).catch(() => void 0);

    return plan;
  }
}

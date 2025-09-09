/* This stage performs policy checks on incoming intents, including
   account allowlists and queue capacity/backpressure.

   On success, intent is moved to QUEUED state.
   On failure, intent is moved to REJECTED with appropriate reason.
*/

import { IntentState, ReasonCategory } from '@kestrel-hq/dto'
import { reason } from '@kestrel-hq/reasons'
import { ReasonedRejection } from '@kestrel-hq/reasons'
import * as fs from 'fs'
import * as path from 'path'

type Ctx = {
  intent: any
  corr_id: string
  request_hash?: string
  cfg: any
  queue?: { capacity?: number; enqueue?: (intent: any) => Promise<boolean> }
}

// Profit calculation configuration
interface ProfitGateConfig {
  minProfitWei: bigint
  minRoiBps: number
  maxFeePerGas: bigint
  maxPriorityFeeGas: bigint
  flashLoanUsed: boolean
  flashPremiumBps: number
  tipWei: bigint
}

const DEFAULT_PROFIT_CONFIG: ProfitGateConfig = {
  minProfitWei: BigInt('1000000000000000'), // 0.001 ETH minimum
  minRoiBps: 50, // 0.5% minimum ROI
  maxFeePerGas: BigInt('50000000000'), // 50 gwei
  maxPriorityFeeGas: BigInt('2000000000'), // 2 gwei
  flashLoanUsed: false,
  flashPremiumBps: 9, // 0.09% Aave premium
  tipWei: BigInt('0')
}

/**
 * Calculate expected profit for triangular arbitrage
 * Formula: profit = expectedOut - amountIn - flashPremium - gasCost - tip
 */
function expectedProfitWei(
  candidate: any,
  quote: any,
  gasEstimate: bigint,
  config: ProfitGateConfig
): bigint {
  // For triangular arbitrage, profit = expectedOut - amountIn
  const amountIn = BigInt(candidate.amountIn || '0')
  const expectedOut = BigInt(quote.amountOut || '0')

  // Calculate gas cost
  const gasCostWei = gasEstimate * (config.maxFeePerGas + config.maxPriorityFeeGas)

  // Calculate flash loan premium if applicable
  const flashPremiumWei = config.flashLoanUsed
    ? (amountIn * BigInt(config.flashPremiumBps)) / BigInt(10000)
    : BigInt(0)

  // Total cost = gas + flash premium + tip
  const totalCostWei = gasCostWei + flashPremiumWei + config.tipWei

  // Profit = expected output - input amount - total costs
  const profitWei = expectedOut - amountIn - totalCostWei

  return profitWei
}

/**
 * Check if arbitrage opportunity meets profit thresholds
 */
function checkProfitGate(
  candidate: any,
  quote: any,
  gasEstimate: bigint,
  config: ProfitGateConfig,
  corrId: string,
  intentId: string
): { ok: boolean; reason?: string; auditData: any } {
  // Calculate profit
  const profitWei = expectedProfitWei(candidate, quote, gasEstimate, config)
  const roiBps = candidate.amountIn && candidate.amountIn > BigInt(0)
    ? Number((profitWei * BigInt(10000)) / candidate.amountIn)
    : 0

  // Calculate costs for audit
  const gasCostWei = gasEstimate * (config.maxFeePerGas + config.maxPriorityFeeGas)
  const flashPremiumWei = config.flashLoanUsed
    ? (candidate.amountIn * BigInt(config.flashPremiumBps)) / BigInt(10000)
    : BigInt(0)
  const totalCostWei = gasCostWei + flashPremiumWei + config.tipWei

  const auditData = {
    amountInWei: candidate.amountIn?.toString() || '0',
    expectedOutWei: quote.amountOut?.toString() || '0',
    profitWei: profitWei.toString(),
    roiBps,
    gasEstimate: gasEstimate.toString(),
    gasCostWei: gasCostWei.toString(),
    flashPremiumWei: flashPremiumWei.toString(),
    totalCostWei: totalCostWei.toString(),
    flashLoanUsed: config.flashLoanUsed,
    flashPremiumBps: config.flashPremiumBps,
    minProfitWei: config.minProfitWei.toString(),
    minRoiBps: config.minRoiBps
  }

  // Check profit threshold
  if (profitWei <= config.minProfitWei) {
    return {
      ok: false,
      reason: `Profit too low: ${profitWei} wei <= ${config.minProfitWei} wei minimum`,
      auditData
    }
  }

  // Check ROI threshold
  if (roiBps < config.minRoiBps) {
    return {
      ok: false,
      reason: `ROI too low: ${roiBps} bps < ${config.minRoiBps} bps minimum`,
      auditData
    }
  }

  return { ok: true, auditData }
}

/**
 * Log profit check results to audit file
 */
function logProfitCheck(
  result: { ok: boolean; reason?: string; auditData: any },
  corrId: string,
  intentId: string
): void {
  try {
    const dir = path.resolve(__dirname, '..', 'logs')
    fs.mkdirSync(dir, { recursive: true })

    const file = path.join(dir, 'profit-gate-audit.jsonl')
    const record = {
      ts: new Date().toISOString(),
      corr_id: corrId,
      intent_id: intentId,
      check_passed: result.ok,
      failure_reason: result.reason || null,
      ...result.auditData
    }

    fs.appendFileSync(file, JSON.stringify(record) + '\n')
  } catch (error) {
    console.warn('[ProfitGate] Failed to write audit log:', error)
  }
}

export async function policyIntent(ctx: Ctx) {
  const { intent, corr_id, request_hash } = ctx

  // simple policy checks: account and asset allowlists
  if (ctx.cfg?.policy?.allowedAccounts && Array.isArray(ctx.cfg.policy.allowedAccounts)) {
    const acct = intent.payload?.from
    if (acct && !ctx.cfg.policy.allowedAccounts.includes(acct)) {
      throw new ReasonedRejection(
        reason('POLICY_ACCOUNT_NOT_ALLOWED', { message: 'account not permitted' }),
        'Rejecting at POLICY: account not allowed'
      )
    }
  }

  // Profit gate check for arbitrage opportunities
  if (intent.payload?.candidate && intent.payload?.quote) {
    const candidate = intent.payload.candidate
    const quote = intent.payload.quote
    const gasEstimate = intent.payload.gasEstimate ? BigInt(intent.payload.gasEstimate) : BigInt('500000')

    // Get profit config from ctx.cfg or use defaults
    const profitConfig: ProfitGateConfig = {
      ...DEFAULT_PROFIT_CONFIG,
      ...ctx.cfg?.profitGate
    }

    const profitCheck = checkProfitGate(candidate, quote, gasEstimate, profitConfig, corr_id, intent.intent_id)

    // Log the profit check result
    logProfitCheck(profitCheck, corr_id, intent.intent_id)

    if (!profitCheck.ok) {
      throw new ReasonedRejection(
        reason('POLICY_FEE_TOO_LOW', {
          message: profitCheck.reason
        }),
        `Rejecting at PROFIT_GATE: ${profitCheck.reason}`
      )
    }

    console.log(`[ProfitGate] ✅ Check passed: ${profitCheck.auditData.profitWei} wei profit, ${profitCheck.auditData.roiBps} bps ROI`)
  }

  // backpressure / queue capacity check
  if (ctx.queue && typeof ctx.queue.enqueue === 'function') {
    const capacity = ctx.queue.capacity ?? ctx.cfg?.queueCapacity ?? 100
    if (capacity <= 0) {
      throw new ReasonedRejection(
        reason('QUEUE_CAPACITY', { message: 'queue full' }),
        'Rejecting at QUEUE: capacity full'
      )
    }

    // attempt to enqueue (if returns false, treat as backpressure)
    try {
      const ok = await ctx.queue.enqueue(intent)
      if (!ok) {
        throw new ReasonedRejection(
          reason('QUEUE_CAPACITY', { message: 'queue backpressure' }),
          'Rejecting at QUEUE: backpressure'
        )
      }
    } catch (e) {
      throw new ReasonedRejection(
        reason('INTERNAL_ERROR', { message: 'queue enqueue failed' }),
        'Rejecting at QUEUE: enqueue failed'
      )
    }
  }

  return { next: IntentState.QUEUED }
}

export default policyIntent

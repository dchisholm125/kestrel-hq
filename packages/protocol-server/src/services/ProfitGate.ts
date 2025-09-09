/**
 * ProfitGate - Profit Calculation and Validation Service
 *
 * Implements strict profit gates for arbitrage opportunities before transaction building.
 * Calculates expected profit for triangular arbitrage and enforces minimum thresholds.
 *
 * Features:
 * - Triangular arbitrage profit calculation
 * - Flash loan premium consideration
 * - Gas cost estimation
 * - Minimum profit and ROI thresholds
 * - Comprehensive audit logging
 *
 * @example
 * ```typescript
 * import { ProfitGate } from './ProfitGate';
 *
 * const gate = new ProfitGate();
 * const result = await gate.checkProfit(candidate, quote, gasEstimate, options);
 *
 * if (result.ok) {
 *   console.log(`Profit check passed: ${result.profitWei} wei profit`);
 * } else {
 *   console.log(`Profit check failed: ${result.reason}`);
 * }
 * ```
 */

import { CandidateArb } from '../../../aerie/src/OpportunityIdentifier';
import { QuoteResult } from '../../../aerie/src/QuoteEngine';

export interface ProfitCheckResult {
  ok: boolean;
  profitWei: bigint;
  profitEth: number;
  roiBps: number; // ROI in basis points (e.g., 50 = 0.5%)
  gasCostWei: bigint;
  flashPremiumWei: bigint;
  totalCostWei: bigint;
  reason?: string;
  auditData: {
    amountInWei: bigint;
    expectedOutWei: bigint;
    gasEstimate: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeeGas: bigint;
    flashLoanUsed: boolean;
    flashPremiumBps: number;
    minProfitWei: bigint;
    minRoiBps: number;
  };
}

export interface ProfitGateOptions {
  minProfitWei?: bigint; // Minimum absolute profit in wei
  minRoiBps?: number; // Minimum ROI in basis points (e.g., 50 = 0.5%)
  maxFeePerGas?: bigint; // Gas price for cost calculation
  maxPriorityFeeGas?: bigint; // Priority fee for cost calculation
  flashLoanUsed?: boolean; // Whether flash loan is used
  flashPremiumBps?: number; // Flash loan premium in basis points
  tipWei?: bigint; // Additional tip for miners/validators
}

export class ProfitGate {
  private defaultOptions: Required<ProfitGateOptions> = {
    minProfitWei: BigInt('1000000000000000'), // 0.001 ETH default minimum
    minRoiBps: 50, // 0.5% default minimum ROI
    maxFeePerGas: BigInt('50000000000'), // 50 gwei default
    maxPriorityFeeGas: BigInt('2000000000'), // 2 gwei default
    flashLoanUsed: false,
    flashPremiumBps: 9, // 0.09% Aave flash loan premium
    tipWei: BigInt('0')
  };

  /**
   * Calculate expected profit for triangular arbitrage
   * Formula: profit = expectedOut - amountIn - flashPremium - gasCost - tip
   */
  expectedProfitWei(
    candidate: CandidateArb,
    quote: QuoteResult,
    gasEstimate: bigint,
    options: Partial<ProfitGateOptions> = {}
  ): bigint {
    const opts = { ...this.defaultOptions, ...options };

    // For triangular arbitrage, profit = expectedOut - amountIn
    // But we need to account for costs
    const amountIn = candidate.amountIn;
    const expectedOut = quote.amountOut;

    // Calculate gas cost
    const gasCostWei = gasEstimate * (opts.maxFeePerGas + opts.maxPriorityFeeGas);

    // Calculate flash loan premium if applicable
    const flashPremiumWei = opts.flashLoanUsed
      ? (amountIn * BigInt(opts.flashPremiumBps)) / BigInt(10000)
      : BigInt(0);

    // Total cost = gas + flash premium + tip
    const totalCostWei = gasCostWei + flashPremiumWei + opts.tipWei;

    // Profit = expected output - input amount - total costs
    const profitWei = expectedOut - amountIn - totalCostWei;

    return profitWei;
  }

  /**
   * Check if the arbitrage opportunity meets profit thresholds
   */
  async checkProfit(
    candidate: CandidateArb,
    quote: QuoteResult,
    gasEstimate: bigint,
    options: Partial<ProfitGateOptions> = {}
  ): Promise<ProfitCheckResult> {
    const opts = { ...this.defaultOptions, ...options };

    // Calculate profit
    const profitWei = this.expectedProfitWei(candidate, quote, gasEstimate, opts);
    const profitEth = Number(profitWei) / 1e18;

    // Calculate ROI (Return on Investment) in basis points
    const roiBps = profitWei > BigInt(0)
      ? Number((profitWei * BigInt(10000)) / candidate.amountIn)
      : 0;

    // Calculate costs for audit data
    const gasCostWei = gasEstimate * (opts.maxFeePerGas + opts.maxPriorityFeeGas);
    const flashPremiumWei = opts.flashLoanUsed
      ? (candidate.amountIn * BigInt(opts.flashPremiumBps)) / BigInt(10000)
      : BigInt(0);
    const totalCostWei = gasCostWei + flashPremiumWei + opts.tipWei;

    const auditData = {
      amountInWei: candidate.amountIn,
      expectedOutWei: quote.amountOut,
      gasEstimate,
      maxFeePerGas: opts.maxFeePerGas,
      maxPriorityFeeGas: opts.maxPriorityFeeGas,
      flashLoanUsed: opts.flashLoanUsed,
      flashPremiumBps: opts.flashPremiumBps,
      minProfitWei: opts.minProfitWei,
      minRoiBps: opts.minRoiBps
    };

    // Check profit threshold
    if (profitWei <= opts.minProfitWei) {
      return {
        ok: false,
        profitWei,
        profitEth,
        roiBps,
        gasCostWei,
        flashPremiumWei,
        totalCostWei,
        reason: `Profit too low: ${profitWei} wei <= ${opts.minProfitWei} wei minimum`,
        auditData
      };
    }

    // Check ROI threshold
    if (roiBps < opts.minRoiBps) {
      return {
        ok: false,
        profitWei,
        profitEth,
        roiBps,
        gasCostWei,
        flashPremiumWei,
        totalCostWei,
        reason: `ROI too low: ${roiBps} bps < ${opts.minRoiBps} bps minimum`,
        auditData
      };
    }

    // All checks passed
    return {
      ok: true,
      profitWei,
      profitEth,
      roiBps,
      gasCostWei,
      flashPremiumWei,
      totalCostWei,
      auditData
    };
  }

  /**
   * Log profit check results to audit file
   */
  async logProfitCheck(
    candidate: CandidateArb,
    result: ProfitCheckResult,
    corrId: string,
    intentId: string
  ): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');

      const dir = path.resolve(__dirname, '..', 'logs');
      fs.mkdirSync(dir, { recursive: true });

      const file = path.join(dir, 'profit-gate-audit.jsonl');
      const record = {
        ts: new Date().toISOString(),
        corr_id: corrId,
        intent_id: intentId,
        candidate_id: candidate.id,
        chain_id: candidate.chainId,
        token_in: candidate.tokenIn,
        token_out: candidate.tokenOut,
        amount_in_wei: candidate.amountIn.toString(),
        expected_out_wei: result.auditData.expectedOutWei.toString(),
        profit_wei: result.profitWei.toString(),
        profit_eth: result.profitEth,
        roi_bps: result.roiBps,
        gas_estimate: result.auditData.gasEstimate.toString(),
        gas_cost_wei: result.gasCostWei.toString(),
        flash_premium_wei: result.flashPremiumWei.toString(),
        total_cost_wei: result.totalCostWei.toString(),
        flash_loan_used: result.auditData.flashLoanUsed,
        flash_premium_bps: result.auditData.flashPremiumBps,
        min_profit_wei: result.auditData.minProfitWei.toString(),
        min_roi_bps: result.auditData.minRoiBps,
        check_passed: result.ok,
        failure_reason: result.reason || null
      };

      fs.appendFileSync(file, JSON.stringify(record) + '\n');
    } catch (error) {
      console.warn('[ProfitGate] Failed to write audit log:', error);
    }
  }
}

// Convenience function for simple profit checks
export async function checkArbitrageProfit(
  candidate: CandidateArb,
  quote: QuoteResult,
  gasEstimate: bigint,
  options: Partial<ProfitGateOptions> = {}
): Promise<ProfitCheckResult> {
  const gate = new ProfitGate();
  return gate.checkProfit(candidate, quote, gasEstimate, options);
}

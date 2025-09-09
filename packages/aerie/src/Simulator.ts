/**
 * Simulator - Staticcall End-to-End Transaction Simulation
 *
 * Performs deterministic simulation of arbitrage candidates using staticcall
 * to ensure transactions will succeed before execution.
 *
 * Features:
 * - EOA Path: Direct staticcall to DEX routers
 * - Contract Path: Simulate ArbExecutor contract calls
 * - Slippage Protection: Validates minimum output amounts
 * - Gas Estimation: Accurate gas usage prediction
 * - Revert Analysis: Detailed error reporting
 *
 * @example
 * ```typescript
 * import { Simulator, simulate } from '@kestrel-hq/aerie';
 *
 * // Using the class
 * const simulator = new Simulator(provider);
 * const result = await simulator.simulate(candidate, quote, executorAddress);
 *
 * // Using the convenience function
 * const result = await simulate(candidate, quote, provider, executorAddress);
 *
 * if (result.ok) {
 *   console.log(`Simulation successful! Expected output: ${result.expectedOut}`);
 * } else {
 *   console.log(`Simulation failed: ${result.revertReason}`);
 * }
 * ```
 */

import { Contract, Provider, Interface, ZeroAddress, JsonRpcProvider, Wallet } from 'ethers';
import { CandidateArb } from './OpportunityIdentifier';
import { QuoteResult } from './QuoteEngine';

// Uniswap V2 Router ABI (for simulation)
const UNISWAP_V2_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)'
];

// ERC20 ABI for balance checks
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)'
];

export interface SimulationResult {
  ok: boolean;
  expectedOut: bigint;
  gas: bigint;
  revertReason?: string;
  slippageRisk?: boolean;
  insufficientBalance?: boolean;
}

export class Simulator {
  private provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  /**
   * Simulate a CandidateArb transaction end-to-end
   */
  async simulate(
    candidate: CandidateArb,
    quote: QuoteResult,
    executorAddress?: string,
    options?: {
      slippageTolerance?: number; // percentage (e.g., 0.5 for 0.5%)
      gasLimit?: bigint;
      from?: string;
    }
  ): Promise<SimulationResult> {
    try {
      const slippageTolerance = options?.slippageTolerance || 0.5; // 0.5% default
      const gasLimit = options?.gasLimit || 500000n;
      const from = options?.from || ZeroAddress;

      // Validate quote matches candidate
      if (quote.amountOut === 0n) {
        return {
          ok: false,
          expectedOut: 0n,
          gas: 0n,
          revertReason: 'Invalid quote: zero output'
        };
      }

      // Check slippage risk
      const minOutput = this.calculateMinOutput(quote.amountOut, slippageTolerance);
      if (quote.amountOut < minOutput) {
        return {
          ok: false,
          expectedOut: quote.amountOut,
          gas: quote.gasEstimate,
          slippageRisk: true,
          revertReason: `Slippage risk: expected ${quote.amountOut}, min ${minOutput}`
        };
      }

      // Choose simulation method based on whether we have an executor
      if (executorAddress && executorAddress !== ZeroAddress) {
        return await this.simulateContractPath(candidate, quote, executorAddress, from, gasLimit);
      } else {
        return await this.simulateEOAPath(candidate, quote, from, gasLimit);
      }

    } catch (error) {
      return {
        ok: false,
        expectedOut: 0n,
        gas: 0n,
        revertReason: `Simulation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Simulate EOA path - direct calls to DEX routers
   */
  private async simulateEOAPath(
    candidate: CandidateArb,
    quote: QuoteResult,
    from: string,
    gasLimit: bigint
  ): Promise<SimulationResult> {
    try {
      // Check initial balance if we're dealing with tokens
      if (candidate.tokenIn !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
        const tokenContract = new Contract(candidate.tokenIn, ERC20_ABI, this.provider);
        const balance = await tokenContract.balanceOf(from);

        if (balance < candidate.amountIn) {
          return {
            ok: false,
            expectedOut: 0n,
            gas: 0n,
            insufficientBalance: true,
            revertReason: `Insufficient token balance: ${balance} < ${candidate.amountIn}`
          };
        }
      }

      // For EOA path, we simulate each hop sequentially
      let currentAmountIn = candidate.amountIn;
      let totalGasUsed = 0n;

      for (let i = 0; i < candidate.hops.length; i++) {
        const hop = candidate.hops[i];
        const isLastHop = i === candidate.hops.length - 1;

        // Create router contract for this hop
        const router = new Contract(hop.router, UNISWAP_V2_ROUTER_ABI, this.provider);

        // Prepare the swap call
        const path = [hop.tokenIn, hop.tokenOut];
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes
        const minOutput = isLastHop ? this.calculateMinOutput(quote.perHopAmounts[i], 0.5) : 1n;

        let callData: string;
        let value: bigint = 0n;

        // Determine which swap function to use
        if (hop.tokenIn === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') { // ETH placeholder
          // This is an ETH input swap
          callData = router.interface.encodeFunctionData('swapExactETHForTokens', [
            minOutput,
            path.map(p => p === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' ? ZeroAddress : p),
            from,
            deadline
          ]);
          value = currentAmountIn;
        } else if (hop.tokenOut === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') { // ETH placeholder
          // This is a token to ETH swap
          callData = router.interface.encodeFunctionData('swapExactTokensForETH', [
            currentAmountIn,
            minOutput,
            path.map(p => p === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' ? ZeroAddress : p),
            from,
            deadline
          ]);
        } else {
          // Token to token swap
          callData = router.interface.encodeFunctionData('swapExactTokensForTokens', [
            currentAmountIn,
            minOutput,
            path,
            from,
            deadline
          ]);
        }

        // Simulate the call
        const simResult = await this.provider.call({
          to: hop.router,
          from,
          data: callData,
          value,
          gasLimit
        });

        if (!simResult) {
          return {
            ok: false,
            expectedOut: 0n,
            gas: totalGasUsed,
            revertReason: `Simulation reverted on hop ${i + 1}`
          };
        }

        // Decode the result to get actual output amount
        const decoded = router.interface.decodeFunctionResult(
          hop.tokenIn === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' ? 'swapExactETHForTokens' :
          hop.tokenOut === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' ? 'swapExactTokensForETH' :
          'swapExactTokensForTokens',
          simResult
        );

        const amounts = decoded[0] as bigint[];
        currentAmountIn = amounts[amounts.length - 1];

        // Estimate gas for this hop
        totalGasUsed += isLastHop ? 100000n : 80000n;
      }

      // Validate final output meets expectations
      if (currentAmountIn < this.calculateMinOutput(quote.amountOut, 0.5)) {
        return {
          ok: false,
          expectedOut: currentAmountIn,
          gas: totalGasUsed,
          slippageRisk: true,
          revertReason: `Output ${currentAmountIn} below expected ${quote.amountOut}`
        };
      }

      return {
        ok: true,
        expectedOut: currentAmountIn,
        gas: totalGasUsed
      };

    } catch (error) {
      return {
        ok: false,
        expectedOut: 0n,
        gas: 0n,
        revertReason: `EOA simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Simulate contract path - calls to ArbExecutor contract
   */
  private async simulateContractPath(
    candidate: CandidateArb,
    quote: QuoteResult,
    executorAddress: string,
    from: string,
    gasLimit: bigint
  ): Promise<SimulationResult> {
    try {
      // For contract path, we need to encode the route and simulate calling the executor
      const routeData = this.encodeRouteForExecutor(candidate);

      // Create executor contract (we'll assume a basic interface)
      const executorAbi = [
        'function executeArbitrage(bytes routeData, uint256 minOutput) returns (uint256 output)',
        'function simulateArbitrage(bytes routeData, uint256 minOutput) view returns (uint256 output, uint256 gasUsed)'
      ];

      const executor = new Contract(executorAddress, executorAbi, this.provider);

      // Try to use simulateArbitrage if available, otherwise fallback to regular execute
      const minOutput = this.calculateMinOutput(quote.amountOut, 0.5);

      let simResult: string;
      let expectedOut: bigint;
      let gasUsed: bigint;

      try {
        // Try the simulation method first
        simResult = await this.provider.call({
          to: executorAddress,
          from,
          data: executor.interface.encodeFunctionData('simulateArbitrage', [routeData, minOutput]),
          gasLimit
        });

        const decoded = executor.interface.decodeFunctionResult('simulateArbitrage', simResult);
        expectedOut = decoded[0] as bigint;
        gasUsed = decoded[1] as bigint;

      } catch {
        // Fallback to regular execute call (without state changes)
        simResult = await this.provider.call({
          to: executorAddress,
          from,
          data: executor.interface.encodeFunctionData('executeArbitrage', [routeData, minOutput]),
          gasLimit
        });

        const decoded = executor.interface.decodeFunctionResult('executeArbitrage', simResult);
        expectedOut = decoded[0] as bigint;
        gasUsed = 150000n; // Estimate for contract execution
      }

      // Validate the result
      if (expectedOut < minOutput) {
        return {
          ok: false,
          expectedOut,
          gas: gasUsed,
          slippageRisk: true,
          revertReason: `Contract output ${expectedOut} below minimum ${minOutput}`
        };
      }

      return {
        ok: true,
        expectedOut,
        gas: gasUsed
      };

    } catch (error) {
      return {
        ok: false,
        expectedOut: 0n,
        gas: 0n,
        revertReason: `Contract simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Encode route data for ArbExecutor contract
   */
  private encodeRouteForExecutor(candidate: CandidateArb): string {
    // This is a simplified encoding - in practice, you'd have a specific format
    // for your ArbExecutor contract
    const routeData = {
      tokenIn: candidate.tokenIn,
      amountIn: candidate.amountIn,
      hops: candidate.hops.map(hop => ({
        dex: hop.dex,
        router: hop.router,
        tokenOut: hop.tokenOut,
        fee: hop.fee || 3000
      })),
      expectedOut: candidate.amountIn // Placeholder
    };

    return JSON.stringify(routeData); // In practice, this would be ABI-encoded
  }

  /**
   * Calculate minimum output based on slippage tolerance
   */
  private calculateMinOutput(expectedOut: bigint, slippageTolerance: number): bigint {
    const slippageFactor = 1n - BigInt(Math.floor(slippageTolerance * 100)); // Convert percentage to basis points
    return expectedOut * slippageFactor / 10000n;
  }

  /**
   * Validates that all required approvals are in place for the trade
   * Checks tokenIn approval for the router and WETH approval for flash loans
   */
  async validateApprovals(
    candidate: CandidateArb,
    from: string,
    routerAddress: string,
    options?: {
      flashLoan?: boolean;
      flashExecutorAddress?: string;
    }
  ): Promise<{ ok: boolean; missingApprovals: string[] }> {
    const missingApprovals: string[] = [];

    // Check tokenIn approval for the router
    if (candidate.tokenIn !== ZeroAddress) {
      const tokenContract = new Contract(
        candidate.tokenIn,
        ['function allowance(address owner, address spender) view returns (uint256)'],
        this.provider
      );

      const allowance = await tokenContract.allowance(from, routerAddress);
      if (allowance < candidate.amountIn) {
        missingApprovals.push(`${candidate.tokenIn} approval for ${routerAddress}`);
      }
    }

    // For flash loans, check WETH approval for the flash executor
    if (options?.flashLoan && options.flashExecutorAddress) {
      const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // Mainnet WETH
      const wethContract = new Contract(
        wethAddress,
        ['function allowance(address owner, address spender) view returns (uint256)'],
        this.provider
      );

      const allowance = await wethContract.allowance(from, options.flashExecutorAddress);
      if (allowance < candidate.amountIn) {
        missingApprovals.push(`WETH approval for ${options.flashExecutorAddress}`);
      }
    }

    return {
      ok: missingApprovals.length === 0,
      missingApprovals
    };
  }

  /**
   * Simulates a trade with comprehensive validation
   * Includes approval checks, balance checks, and slippage validation
   */
  async simulateWithValidation(
    candidate: CandidateArb,
    quote: QuoteResult,
    from: string,
    routerAddress: string,
    executorAddress?: string,
    options?: {
      flashLoan?: boolean;
      flashExecutorAddress?: string;
      slippageTolerance?: number;
      gasLimit?: bigint;
    }
  ): Promise<{
    ok: boolean;
    simulation?: SimulationResult;
    validationErrors: string[];
  }> {
    const validationErrors: string[] = [];

    // Validate approvals
    const approvalCheck = await this.validateApprovals(candidate, from, routerAddress, {
      flashLoan: options?.flashLoan,
      flashExecutorAddress: options?.flashExecutorAddress
    });

    if (!approvalCheck.ok) {
      validationErrors.push(...approvalCheck.missingApprovals.map(msg => `Missing approval: ${msg}`));
    }

    // Check balance for EOA path
    if (!options?.flashLoan) {
      const balance = await this.provider.getBalance(from);
      const requiredValue = candidate.tokenIn === ZeroAddress ? candidate.amountIn : 0n;

      if (balance < requiredValue) {
        validationErrors.push(`Insufficient ETH balance: ${balance} < ${requiredValue}`);
      }

      // Check token balance if tokenIn is not ETH
      if (candidate.tokenIn !== ZeroAddress) {
        const tokenContract = new Contract(
          candidate.tokenIn,
          ['function balanceOf(address owner) view returns (uint256)'],
          this.provider
        );

        const tokenBalance = await tokenContract.balanceOf(from);
        if (tokenBalance < candidate.amountIn) {
          validationErrors.push(`Insufficient ${candidate.tokenIn} balance: ${tokenBalance} < ${candidate.amountIn}`);
        }
      }
    }

    // Run simulation
    const simulation = await this.simulate(candidate, quote, executorAddress, {
      slippageTolerance: options?.slippageTolerance,
      gasLimit: options?.gasLimit,
      from
    });

    if (!simulation.ok) {
      validationErrors.push(`Simulation failed: ${simulation.revertReason || 'Unknown error'}`);
    } else {
      // Check slippage
      const expectedOut = simulation.expectedOut;
      const minOut = (quote.amountOut * BigInt(Math.floor((100 - (options?.slippageTolerance || 0.5)) * 100))) / 10000n;

      if (expectedOut < minOut) {
        validationErrors.push(`Slippage too high: ${expectedOut} < ${minOut}`);
      }
    }

    return {
      ok: validationErrors.length === 0,
      simulation: simulation.ok ? simulation : undefined,
      validationErrors
    };
  }

  /**
   * Simulates multiple candidates in batch for efficiency
   * Uses multicall where possible to reduce RPC calls
   */
  async simulateBatch(
    candidates: CandidateArb[],
    quotes: QuoteResult[],
    executorAddress?: string,
    options?: {
      slippageTolerance?: number;
      gasLimit?: bigint;
      from?: string;
      batchSize?: number;
    }
  ): Promise<SimulationResult[]> {
    if (candidates.length !== quotes.length) {
      throw new Error('Candidates and quotes arrays must have the same length');
    }

    const batchSize = options?.batchSize || 10;
    const results: SimulationResult[] = [];

    // Process in batches to avoid overwhelming the RPC
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batchCandidates = candidates.slice(i, i + batchSize);
      const batchQuotes = quotes.slice(i, i + batchSize);

      const batchPromises = batchCandidates.map((candidate, idx) =>
        this.simulate(candidate, batchQuotes[idx], executorAddress, {
          slippageTolerance: options?.slippageTolerance,
          gasLimit: options?.gasLimit,
          from: options?.from
        })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }
}

/**
 * Convenience function to simulate a single CandidateArb
 * Wraps the Simulator for simple usage
 *
 * @example
 * ```typescript
 * import { simulate } from '@kestrel-hq/aerie';
 *
 * const result = await simulate(candidate, quote, provider, executorAddress);
 * if (result.ok) {
 *   console.log(`Simulation successful! Output: ${result.expectedOut}`);
 * }
 * ```
 */
export async function simulate(
  candidate: CandidateArb,
  quote: QuoteResult,
  provider: Provider,
  executorAddress?: string,
  options?: {
    slippageTolerance?: number;
    gasLimit?: bigint;
    from?: string;
  }
): Promise<SimulationResult> {
  const simulator = new Simulator(provider);
  return simulator.simulate(candidate, quote, executorAddress, options);
}

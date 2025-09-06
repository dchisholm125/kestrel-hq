import { Contract, Interface, Provider, TransactionRequest, ZeroAddress } from 'ethers';
import { Opportunity, DEX_ROUTERS, WETH_ADDRESS } from './OpportunityIdentifier';

// Uniswap V2 constants
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V2_PAIR_INIT_CODE_HASH = '0x96e8ac427619fd92eb2c6f262675c0e4bcea386fe7a3b6d3c6c8f8f8f8f8f8f'; // placeholder (not used directly here)

// Minimal ABIs
const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];

const UNISWAP_V2_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)'
];

// Interface for encoding router calldata
const routerIface = new Interface(UNISWAP_V2_ROUTER_ABI);

interface PairOverride {
  address: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
}

export class TradeCrafter {
  constructor(
    private provider: Provider,
    private pairOverride?: PairOverride,
    // balanceOverrides map key format: `${tokenAddress.toLowerCase()}:${owner.toLowerCase()}` => balance
    private balanceOverrides?: Record<string, bigint>
  ) {}

  /**
   * Craft a reverse (token -> WETH) swap for a detected ETH->Token opportunity.
   * Simplified heuristic:
   *  - Take a portion of tokenOut balance implied by reserves impact (placeholder: small percentage of reserveOut)
   *  - Compute expected WETH output using Uniswap V2 formula with 0.3% fee.
   *  - If output > 0, build unsigned tx calling Router.swapExactTokensForTokens.
   */
  public async craftBackrun(opportunity: Opportunity, executorAddress?: string, options?: { amountInWei?: bigint }): Promise<TransactionRequest | null> {
    try {
      // Only handle simple 2-token path (WETH -> TOKEN) to reverse (TOKEN -> WETH)
      if (opportunity.path.length !== 2) return null;
      const [tokenInOriginal, tokenOutOriginal] = opportunity.path; // tokenInOriginal should be WETH, tokenOutOriginal is target token
      if (tokenInOriginal !== WETH_ADDRESS) return null; // strategy limited
      const tokenOut = tokenOutOriginal;
      const tokenIn = tokenInOriginal; // WETH

      if (!executorAddress) {
        // Need an address to evaluate balance; without it we can't safely craft
        return null;
      }

      // Derive pair address via factory call (simplify by fetching from on-chain using factory's getPair if needed)
      // We'll identify pair by searching token ordering in pair contract once fetched.
      let reserve0: bigint, reserve1: bigint, token0: string, token1: string;
      if (this.pairOverride) {
        ({ reserve0, reserve1 } = this.pairOverride);
        token0 = this.pairOverride.token0.toLowerCase();
        token1 = this.pairOverride.token1.toLowerCase();
      } else {
        const pairAddress = await this.findPairAddress(tokenIn, tokenOut);
        if (!pairAddress) return null;
        const pair = new Contract(pairAddress, UNISWAP_V2_PAIR_ABI, this.provider);
        [reserve0, reserve1] = await this.getReserves(pair);
        token0 = (await pair.token0()).toLowerCase();
        token1 = (await pair.token1()).toLowerCase();
      }

      let reserveTokenIn: bigint;
      let reserveTokenOut: bigint;
      if (token0 === tokenIn && token1 === tokenOut) {
        reserveTokenIn = reserve0;
        reserveTokenOut = reserve1;
      } else if (token0 === tokenOut && token1 === tokenIn) {
        reserveTokenIn = reserve1; // WETH reserve
        reserveTokenOut = reserve0; // token reserve
      } else {
        return null; // mismatch
      }

      // 1) Simulate the victim swap (WETH -> tokenOut) to get post-trade reserves
      const victimEthIn = opportunity.amountInWei ?? 0n;
      if (victimEthIn <= 0n) return null;
      const { amountOut: victimTokenOutOut, newReserveIn: postEthReserve, newReserveOut: postTokenReserve } =
        this.simulateSwapExactIn(reserveTokenIn, reserveTokenOut, victimEthIn);
      if (victimTokenOutOut <= 0n) return null;

      // 2) Oracle price (fair market) in WETH per token using pre-victim mid price (MVP via pool reserves)
      const fairPriceWethPerToken = this.getMidPriceWethPerToken(reserveTokenIn, reserveTokenOut);
      if (fairPriceWethPerToken <= 0n) return null;

      // 3) Choose optimal back-run amount (TOKEN -> WETH) under our balance via binary search maximization
      const walletBalance = await this.getTokenBalance(tokenOut, executorAddress);
      if (walletBalance <= 0n) return null;

      let amountInTokenOut: bigint;
      let expectedWethOut: bigint;
      let expectedProfitWeth: bigint;

      if (options?.amountInWei && options.amountInWei > 0n) {
        // Use provided amountInWei
        amountInTokenOut = options.amountInWei > walletBalance ? walletBalance : options.amountInWei;
        const { amountOut } = this.simulateSwapExactIn(postTokenReserve, postEthReserve, amountInTokenOut);
        expectedWethOut = amountOut;
        const cost = (amountInTokenOut * fairPriceWethPerToken) / 10_000_000_000_000_000_000n;
        expectedProfitWeth = amountOut - cost;
      } else {
        // Use optimizer
        const maxSell = walletBalance;
        const optimizer = this.maximizeProfitTokenSell(
          maxSell,
          postTokenReserve,
          postEthReserve,
          fairPriceWethPerToken
        );
        amountInTokenOut = optimizer.bestAmountIn;
        expectedWethOut = optimizer.expectedWethOut;
        expectedProfitWeth = optimizer.expectedProfitWeth;

        // Fallback: try a small fraction (0.1%) of post-token reserve if optimizer yields zero
        if (amountInTokenOut <= 0n) {
          const candidate = postTokenReserve / 1000n; // 0.1%
          if (candidate > 0n) {
            const { amountOut } = this.simulateSwapExactIn(postTokenReserve, postEthReserve, candidate);
            const cost = (candidate * fairPriceWethPerToken) / 10_000_000_000_000_000_000n;
            const profit = amountOut - cost;
            if (profit > 0n) {
              amountInTokenOut = candidate;
              expectedWethOut = amountOut;
              expectedProfitWeth = profit;
            }
          }
        }
      }

      if (amountInTokenOut <= 0n || expectedWethOut <= 0n) return null;

      // 4) Gas estimation and profitability check: proceed only if expected profit exceeds gas cost
      const routerAddress = this.pickRouterAddress(opportunity.dex);
      if (!routerAddress) return null;

      const reversePath = [tokenOut, tokenIn];
      const amountIn = amountInTokenOut;
      const amountOutMin = (expectedWethOut * 995n) / 1000n; // 0.5% slippage buffer
      const to = executorAddress; // send proceeds to executor
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 5);

      const data = routerIface.encodeFunctionData('swapExactTokensForTokens', [
        amountIn,
        amountOutMin,
        reversePath,
        to,
        deadline
      ]);

      const unsignedTx: TransactionRequest = {
        to: routerAddress,
        data,
        from: executorAddress,
        value: 0n
      };

      // Estimate gas and fee
      let estimatedGasCostWei: bigint | null = null;
      try {
        const gas = await this.provider.estimateGas(unsignedTx);
        const feeData = await this.provider.getFeeData();
        const gasPrice = (feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n) as bigint;
        if (gas && gasPrice && gasPrice > 0n) {
          estimatedGasCostWei = (gas as unknown as bigint) * gasPrice;
        }
      } catch (_) {
        // ignore; if we cannot estimate gas cost, be conservative and skip
        estimatedGasCostWei = null;
      }

      if (estimatedGasCostWei === null) return null;

  if (expectedProfitWeth < estimatedGasCostWei) {
        return null; // Not profitable after gas
      }

      return unsignedTx;
    } catch (err) {
      // console.debug('[TradeCrafter] craftBackrun error', err);
      return null;
    }
  }

  private async getTokenBalance(token: string, owner: string): Promise<bigint> {
    const key = token.toLowerCase() + ':' + owner.toLowerCase();
    if (this.balanceOverrides && key in this.balanceOverrides) {
      return this.balanceOverrides[key]!;
    }
    try {
      const erc20 = new Contract(token, ['function balanceOf(address) view returns (uint256)'], this.provider);
      const bal = await erc20.balanceOf(owner);
      return BigInt(bal.toString());
    } catch (_) {
      return 0n;
    }
  }

  private async getReserves(pair: Contract): Promise<[bigint, bigint]> {
    const { reserve0, reserve1 } = await pair.getReserves();
    return [BigInt(reserve0), BigInt(reserve1)];
  }

  // Simplistic: attempt to fetch pair via factory.getPair call; fallback null
  private async findPairAddress(tokenA: string, tokenB: string): Promise<string | null> {
    try {
      const factory = new Contract(UNISWAP_V2_FACTORY, ['function getPair(address,address) view returns (address)'], this.provider);
      const addr: string = await factory.getPair(tokenA, tokenB);
      if (addr && addr !== ZeroAddress) return addr;
      return null;
    } catch (_) {
      return null;
    }
  }

  // Compute mid price in WETH per token from reserves (pre-trade fair price)
  private getMidPriceWethPerToken(reserveWeth: bigint, reserveToken: bigint): bigint {
    if (reserveToken === 0n) return 0n;
    return (reserveWeth * 10_000_000_000_000_000_000n) / reserveToken; // scale by 1e18 to preserve precision
  }

  // Simulate Uniswap V2 swapExactTokensForTokens amountOut and resulting reserves.
  private simulateSwapExactIn(
    reserveIn: bigint,
    reserveOut: bigint,
    amountIn: bigint
  ): { amountOut: bigint; newReserveIn: bigint; newReserveOut: bigint } {
    if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
      return { amountOut: 0n, newReserveIn: reserveIn, newReserveOut: reserveOut };
    }
    const amountInWithFee = amountIn * 997n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;
    const amountOut = numerator / denominator;
    const newReserveIn = reserveIn + amountIn;
    const newReserveOut = reserveOut - amountOut;
    return { amountOut, newReserveIn, newReserveOut };
  }

  // Find the tokenOut amount to sell that maximizes profit: profit(x) = WETH_out_postVictim(x) - x * fairPrice
  // Robust grid search over [0, cap] to avoid pathological rounding; cap is limited by reserves.
  private maximizeProfitTokenSell(
    maxSell: bigint,
    postTokenReserve: bigint,
    postEthReserve: bigint,
    fairPriceWethPerTokenScaled: bigint // scaled by 1e18
  ): { bestAmountIn: bigint; expectedWethOut: bigint; expectedProfitWeth: bigint } {
    if (maxSell <= 0n || postTokenReserve <= 0n || postEthReserve <= 0n) {
      return { bestAmountIn: 0n, expectedWethOut: 0n, expectedProfitWeth: 0n };
    }

    const cap = maxSell < postTokenReserve / 2n ? maxSell : postTokenReserve / 2n;
    if (cap <= 0n) return { bestAmountIn: 0n, expectedWethOut: 0n, expectedProfitWeth: 0n };

    let bestX = 0n;
    let bestProfit = 0n;
    let bestWethOut = 0n;

    const steps = 64n;
    for (let i = 1n; i <= steps; i++) {
      const x = (cap * i) / steps; // linear grid
      if (x <= 0n) continue;
      const { amountOut } = this.simulateSwapExactIn(postTokenReserve, postEthReserve, x);
      const cost = (x * fairPriceWethPerTokenScaled) / 10_000_000_000_000_000_000n;
      const profit = amountOut - cost;
      if (profit > bestProfit) {
        bestProfit = profit;
        bestX = x;
        bestWethOut = amountOut;
      }
    }

    return { bestAmountIn: bestX, expectedWethOut: bestWethOut, expectedProfitWeth: bestProfit };
  }

  private pickRouterAddress(dex: string | null): string | null {
    if (!dex) return null;
    const d = dex.toLowerCase();
    if (d === 'uniswap_v2') return DEX_ROUTERS.UNISWAP_V2;
    if (d === 'sushiswap') return DEX_ROUTERS.SUSHISWAP;
    return null; // unsupported
  }
}

export default TradeCrafter;

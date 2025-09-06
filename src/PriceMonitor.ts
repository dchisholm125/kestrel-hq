import { Provider } from 'ethers'

// Minimal Uniswap V2 pair ABI fragments we might use in default on-chain fetcher
const UNI_V2_PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
]

export interface PairReserves {
  token0: string
  token1: string
  reserve0: bigint
  reserve1: bigint
}

export interface TriangularArbitrageStep {
  pair: string // identifier (tokenIn-tokenOut)
  tokenIn: string
  tokenOut: string
  amountIn: bigint
  amountOut: bigint
}

export interface TriangularArbitrageOpportunity {
  startToken: string
  amountIn: bigint
  amountOut: bigint
  profit: bigint
  steps: TriangularArbitrageStep[]
  dex: string // e.g. 'uniswap_v2'
}

export interface CheckTriangularArbOptions {
  amountIn?: bigint // default 1e18 (assuming 18 decimals token)
  gasCost?: bigint // gas cost in start token units (already converted); default 0
  dex?: string // default 'uniswap_v2'
}

/**
 * Fetcher interface so we can inject deterministic data in tests.
 */
export type PairFetcher = (tokenA: string, tokenB: string) => Promise<PairReserves | null>

/**
 * PriceMonitor – currently only provides triangular arbitrage detection logic (MVP).
 * Designed for extension (multi‑DEX, caching, throttling) later.
 */
export class PriceMonitor {
  private provider?: Provider
  private fetcher: PairFetcher

  constructor(params: { provider?: Provider; fetcher?: PairFetcher }) {
    this.provider = params.provider
    // If no custom fetcher provided, throw for now – on-chain fetch implementation can be added later.
    if (params.fetcher) {
      this.fetcher = params.fetcher
    } else {
      this.fetcher = async () => {
        throw new Error('Default on-chain pair fetcher not implemented; provide a custom fetcher')
      }
    }
  }

  /** Constant product AMM output with 0.30% fee (Uniswap V2 style) */
  private simulateSwap(amountIn: bigint, tokenIn: string, tokenOut: string, reserves: PairReserves): bigint {
    // Align reserves so reserveIn/out correspond to direction
    let reserveIn: bigint
    let reserveOut: bigint
    if (tokenIn.toLowerCase() === reserves.token0.toLowerCase()) {
      reserveIn = reserves.reserve0
      reserveOut = reserves.reserve1
    } else if (tokenIn.toLowerCase() === reserves.token1.toLowerCase()) {
      reserveIn = reserves.reserve1
      reserveOut = reserves.reserve0
    } else {
      throw new Error('tokenIn not in pair')
    }
    // fee 0.3%
    const amountInWithFee = amountIn * 997n
    const numerator = amountInWithFee * reserveOut
    const denominator = reserveIn * 1000n + amountInWithFee
    if (denominator === 0n) return 0n
    return numerator / denominator
  }

  /** Helper to build a human-readable pair key */
  private pairKey(a: string, b: string): string {
    return `${a.toLowerCase()}-${b.toLowerCase()}`
  }

  /**
   * Check a single triangular arbitrage cycle A -> B -> C -> A.
   * Returns null if any pair missing or not profitable after gas.
   */
  public async checkTriangularArb(tokenA: string, tokenB: string, tokenC: string, opts: CheckTriangularArbOptions = {}): Promise<TriangularArbitrageOpportunity | null> {
    const amountIn = opts.amountIn ?? 1_000_000_000_000_000_000n // 1 unit (18 decimals)
    const gasCost = opts.gasCost ?? 0n
    const dex = opts.dex ?? 'uniswap_v2'

    try {
      // Fetch three pairs (order agnostic)
      const [ab, bc, ca] = await Promise.all([
        this.fetcher(tokenA, tokenB),
        this.fetcher(tokenB, tokenC),
        this.fetcher(tokenC, tokenA)
      ])
      if (!ab || !bc || !ca) return null

      // Simulate path
      const outAB = this.simulateSwap(amountIn, tokenA, tokenB, ab)
      if (outAB === 0n) return null
      const outBC = this.simulateSwap(outAB, tokenB, tokenC, bc)
      if (outBC === 0n) return null
      const outCA = this.simulateSwap(outBC, tokenC, tokenA, ca)
      if (outCA === 0n) return null

      const profit = outCA > amountIn ? outCA - amountIn : 0n
      if (profit <= gasCost) return null

      return {
        startToken: tokenA.toLowerCase(),
        amountIn,
        amountOut: outCA,
        profit: profit - gasCost,
        dex,
        steps: [
          {
            pair: this.pairKey(tokenA, tokenB),
            tokenIn: tokenA.toLowerCase(),
            tokenOut: tokenB.toLowerCase(),
            amountIn,
            amountOut: outAB
          },
          {
            pair: this.pairKey(tokenB, tokenC),
            tokenIn: tokenB.toLowerCase(),
            tokenOut: tokenC.toLowerCase(),
            amountIn: outAB,
            amountOut: outBC
          },
          {
            pair: this.pairKey(tokenC, tokenA),
            tokenIn: tokenC.toLowerCase(),
            tokenOut: tokenA.toLowerCase(),
            amountIn: outBC,
            amountOut: outCA
          }
        ]
      }
    } catch (_) {
      return null
    }
  }
}

export default PriceMonitor
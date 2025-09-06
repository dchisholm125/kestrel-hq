import { PriceMonitor, TriangularArbitrageOpportunity } from '../../src/PriceMonitor'

// Helper to build reserves (simulate Uniswap V2 pair)
const makeReserves = (token0: string, token1: string, r0: bigint, r1: bigint) => ({
  token0: token0.toLowerCase(),
  token1: token1.toLowerCase(),
  reserve0: r0,
  reserve1: r1
})

describe('PriceMonitor.checkTriangularArb', () => {
  test('detects profitable triangle', async () => {
    const TOKEN_A = '0xaaaa000000000000000000000000000000000001' // USDC (pretend 18d for test)
    const TOKEN_B = '0xbbbb000000000000000000000000000000000002' // WETH
    const TOKEN_C = '0xcccc000000000000000000000000000000000003' // APE

    // We choose reserves to create slight edge:
    // A/B large, B/C moderate, C/A skewed so final > initial.
    const fetcher = async (x: string, y: string) => {
      const ax = x.toLowerCase();
      const ay = y.toLowerCase();
      const key = [ax, ay].sort().join('-');
      switch (key) {
        case [TOKEN_A, TOKEN_B].sort().join('-'):
          // A-B pair: 1 A ~= 1 B (balanced)
          return makeReserves(TOKEN_A, TOKEN_B, 1_000_000n * 10n ** 18n, 1_000_000n * 10n ** 18n)
        case [TOKEN_B, TOKEN_C].sort().join('-'):
          // B-C: 1 B -> 1.01 C effective
          return makeReserves(TOKEN_B, TOKEN_C, 1_000_000n * 10n ** 18n, 1_010_000n * 10n ** 18n)
        case [TOKEN_C, TOKEN_A].sort().join('-'):
          // C-A: 1 C -> 1.01 A effective
          return makeReserves(TOKEN_C, TOKEN_A, 1_000_000n * 10n ** 18n, 1_010_000n * 10n ** 18n)
        default:
          return null
      }
    }

    const monitor = new PriceMonitor({ fetcher })
    const result = await monitor.checkTriangularArb(TOKEN_A, TOKEN_B, TOKEN_C, { amountIn: 1_000_000_000_000_000_000n })
    expect(result).not.toBeNull()
    expect((result as TriangularArbitrageOpportunity).profit).toBeGreaterThan(0n)
    expect(result?.steps).toHaveLength(3)
    expect(result?.startToken).toBe(TOKEN_A.toLowerCase())
  })

  test('returns null when not profitable', async () => {
    const TOKEN_A = '0xaaaa000000000000000000000000000000000001'
    const TOKEN_B = '0xbbbb000000000000000000000000000000000002'
    const TOKEN_C = '0xcccc000000000000000000000000000000000003'

    const fetcher = async () => makeReserves(TOKEN_A, TOKEN_B, 1_000_000n, 1_000_000n) // intentionally wrong / symmetric

    const monitor = new PriceMonitor({ fetcher: async (x, y) => {
      // same identical pool for all -> no edge
      return makeReserves(x, y, 1_000_000n * 10n ** 18n, 1_000_000n * 10n ** 18n)
    } })

    const result = await monitor.checkTriangularArb(TOKEN_A, TOKEN_B, TOKEN_C)
    expect(result).toBeNull()
  })
})

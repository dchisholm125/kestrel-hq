import { calcEffectiveGasCost, calcBundleFee, rebateSplit } from '../src/fee'

describe('fee bigint math', () => {
  it('calcEffectiveGasCost clamps negatives and multiplies correctly', () => {
    expect(calcEffectiveGasCost(21_000n, 2n, 10n)).toBe(252_000n)
    expect(calcEffectiveGasCost(-1n, 2n, 10n)).toBe(0n)
    expect(calcEffectiveGasCost(1n, -2n, 10n)).toBe(10n)
    expect(calcEffectiveGasCost(1n, 2n, -10n)).toBe(2n)
  })

  const table: Array<{ profit: bigint; gas: bigint; fee: bigint; bot: bigint; protocol: bigint }> = [
    { profit: 1000n, gas: 200n, fee: 200n, bot: 640n, protocol: 160n }, // net=800, 20% protocol
    { profit: 100n, gas: 200n, fee: 100n, bot: 0n, protocol: 0n }, // fee capped at profit, net=0
    { profit: 0n, gas: 0n, fee: 0n, bot: 0n, protocol: 0n },
  ]

  it('calcBundleFee caps at profit and non-negative', () => {
    for (const row of table) {
      expect(calcBundleFee(row.profit, row.gas)).toBe(row.fee)
    }
  })

  it('rebateSplit divides net with fixed bps and conserves total', () => {
    for (const row of table) {
      const { bot, protocol } = rebateSplit(row.profit, row.fee)
      expect(bot).toBe(row.bot)
      expect(protocol).toBe(row.protocol)
      // property: total split equals profit - fee (non-negative)
      const total = bot + protocol
      const net = row.profit - row.fee
      expect(total).toBe(net < 0n ? 0n : net)
    }
  })
})

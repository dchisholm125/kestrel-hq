import { simulateIntentCore } from '../../src/simulation/simulateIntent'

describe('simulateIntentCore', () => {
  it('produces deterministic outputs for simple inputs', () => {
    const out = simulateIntentCore({
      profit: 1000n,
      gasCost: 200n,
      latencyMs: 50,
      risk: 0.1,
      outcomes: [{ p: 0.5, v: 2 }, { p: 0.5, v: 0 }],
    })
    expect(out.bundleFee).toBe(200n)
    expect(out.split.protocol).toBe(160n) // 20% of net (800) = 160
    expect(out.split.bot).toBe(640n)
    expect(out.ev).toBeCloseTo(1)
    expect(out.score).toBeGreaterThan(0)
    expect(out.score).toBeLessThanOrEqual(1)
  })
})

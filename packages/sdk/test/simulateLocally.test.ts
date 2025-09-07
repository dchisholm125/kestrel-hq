import { simulateLocally } from '../src/retry'

// Ensure alignment with server-side simulateIntentCore by using same math parameters

describe('simulateLocally', () => {
  it('matches expected outputs for a simple case', async () => {
    const out = await simulateLocally({
      profit: 1000n,
      gasCost: 200n,
      latencyMs: 50,
      risk: 0.1,
      outcomes: [{ p: 0.5, v: 2 }, { p: 0.5, v: 0 }],
    })
    expect(out.bundleFee).toBe(200n)
    expect(out.split.protocol).toBe(160n)
    expect(out.split.bot).toBe(640n)
    expect(out.ev).toBeCloseTo(1)
    expect(out.score).toBeGreaterThan(0)
    expect(out.score).toBeLessThanOrEqual(1)
  })
})

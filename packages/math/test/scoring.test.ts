import { logisticScore, boundedLinear, scoreByProfit, scoreByLatency, scoreByRisk, combineScores } from '../src/scoring'

describe('scoring', () => {
  it('logisticScore is between 0 and 1 and symmetric at x0', () => {
    const mid = logisticScore(0, 1, 0)
    expect(mid).toBeGreaterThan(0.49)
    expect(mid).toBeLessThan(0.51)
    expect(logisticScore(10, 1, 0)).toBeGreaterThan(0.999)
    expect(logisticScore(-10, 1, 0)).toBeLessThan(0.001)
  })
  it('boundedLinear clamps to [0,1] and handles degenerate ranges', () => {
    expect(boundedLinear(5, 0, 10)).toBe(0.5)
    expect(boundedLinear(-1, 0, 10)).toBe(0)
    expect(boundedLinear(11, 0, 10)).toBe(1)
    expect(boundedLinear(5, 10, 10)).toBe(0.5)
  })

  it('scoreByProfit grows and is bounded', () => {
    expect(scoreByProfit(0n)).toBe(0)
    const a = scoreByProfit(1n)
    const b = scoreByProfit(1_000_000n)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(scoreByProfit(10_000_000_000_000n)).toBeLessThanOrEqual(1)
  })

  it('scoreByLatency decreases with latency and is bounded', () => {
    const fast = scoreByLatency(10)
    const slow = scoreByLatency(1000)
    expect(fast).toBeGreaterThan(slow)
    expect(fast).toBeLessThanOrEqual(1)
    expect(scoreByLatency(-5)).toBeLessThanOrEqual(1)
  })

  it('scoreByRisk inverts risk', () => {
    expect(scoreByRisk(0)).toBe(1)
    expect(scoreByRisk(1)).toBe(0)
    expect(scoreByRisk(0.4)).toBeCloseTo(0.6)
  })

  it('combineScores: known values and monotonicity', () => {
    const w = [1, 1, 1]
    const s1 = combineScores(w, [1, 1, 1])
    const s2 = combineScores(w, [0.5, 1, 1])
    const s3 = combineScores(w, [0.5, 0.5, 1])
    expect(s1).toBeCloseTo(1)
    expect(s2).toBeLessThan(s1)
    expect(s3).toBeLessThan(s2)
    // monotonic in each input
    const base = combineScores([2, 1], [0.4, 0.8])
    const higherFirst = combineScores([2, 1], [0.5, 0.8])
    expect(higherFirst).toBeGreaterThan(base)
  })
})

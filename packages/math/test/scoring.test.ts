import { logisticScore, boundedLinear } from '../src/scoring'

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
})

import { expectedValue, normalizeProbs } from '../src/probability'

describe('probability', () => {
  it('expected value sums p_i * v_i with truncation', () => {
    expect(expectedValue([0.25, 0.75], [10, 20])).toBeCloseTo(17.5)
    expect(expectedValue([1], [5, 6])).toBeCloseTo(5)
  })
  it('normalizeProbs produces non-negative probabilities that sum to 1 (or 0 vector)', () => {
    const v = normalizeProbs([0.2, 0.3, 0.5])
    const sum = v.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1)
    expect(v.every(x => x >= 0)).toBe(true)

    const zero = normalizeProbs([0, 0, 0])
    expect(zero.every(x => x === 0)).toBe(true)
  })
})

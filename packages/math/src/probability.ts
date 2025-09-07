/**
 * probability.ts
 * Pure math functions for probability and expected value; no I/O, no side-effects.
 */

/**
 * expectedValue
 * why this formula: classic definition of expectation for discrete outcomes sum(p_i * v_i); tolerates length mismatch by truncation.
 */
export function expectedValue(probabilities: number[], values: number[]): number {
  const n = Math.min(probabilities.length, values.length)
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += (probabilities[i] || 0) * (values[i] || 0)
  }
  return sum
}

/**
 * normalizeProbs
 * why this formula: L1-normalization to ensure sum <= 1 by scaling if total > 0; preserves zero vector.
 */
export function normalizeProbs(probs: number[]): number[] {
  const total = probs.reduce((a, b) => a + Math.max(0, b || 0), 0)
  if (total <= 0) return probs.map(() => 0)
  return probs.map(p => Math.max(0, p || 0) / total)
}

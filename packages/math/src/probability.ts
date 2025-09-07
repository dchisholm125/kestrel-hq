/**
 * probability.ts
 * Probability helpers for simulating inclusion / failure risk; pure functions only (no I/O, no side-effects).
 */

/**
 * expectedValue (vector forms)
 * why this formula: classic expectation for discrete outcomes sum(p_i * v_i).
 * Two variants are provided: (probs, values) and (outcomes: {p,v}[]).
 */
export function expectedValue(probabilities: number[], values: number[]): number
export function expectedValue(outcomes: Array<{ p: number; v: number }>): number
export function expectedValue(a: any, b?: any): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const probabilities = a as number[]
    const values = b as number[]
    const n = Math.min(probabilities.length, values.length)
    let sum = 0
    for (let i = 0; i < n; i++) {
      sum += (probabilities[i] || 0) * (values[i] || 0)
    }
    return sum
  }
  const outcomes = a as Array<{ p: number; v: number }>
  let s = 0
  for (const o of outcomes) s += (o?.p || 0) * (o?.v || 0)
  return s
}

/**
 * normalizeProbs
 * why this formula: L1-normalization scales non-negative components so that their sum equals 1 when total > 0;
 * preserves the zero vector as all zeros.
 */
export function normalizeProbs(probs: number[]): number[] {
  const total = probs.reduce((a, b) => a + Math.max(0, b || 0), 0)
  if (total <= 0) return probs.map(() => 0)
  return probs.map(p => Math.max(0, p || 0) / total)
}

/**
 * mergeIndependent
 * AND probability for independent events: P(A ∩ B) = P(A) * P(B)
 */
export function mergeIndependent(p1: number, p2: number): number {
  const c = (p: number) => Math.max(0, Math.min(1, p || 0))
  return c(p1) * c(p2)
}

/**
 * mergeEither
 * OR probability for independent events: P(A ∪ B) = P(A) + P(B) − P(A)P(B)
 */
export function mergeEither(p1: number, p2: number): number {
  const c = (p: number) => Math.max(0, Math.min(1, p || 0))
  const a = c(p1)
  const b = c(p2)
  return a + b - a * b
}

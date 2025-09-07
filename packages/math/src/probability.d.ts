/**
 * probability.ts
 * Probability helpers for simulating inclusion / failure risk; pure functions only (no I/O, no side-effects).
 */
/**
 * expectedValue (vector forms)
 * why this formula: classic expectation for discrete outcomes sum(p_i * v_i).
 * Two variants are provided: (probs, values) and (outcomes: {p,v}[]).
 */
export declare function expectedValue(probabilities: number[], values: number[]): number;
export declare function expectedValue(outcomes: Array<{
    p: number;
    v: number;
}>): number;
/**
 * normalizeProbs
 * why this formula: L1-normalization scales non-negative components so that their sum equals 1 when total > 0;
 * preserves the zero vector as all zeros.
 */
export declare function normalizeProbs(probs: number[]): number[];
/**
 * mergeIndependent
 * AND probability for independent events: P(A ∩ B) = P(A) * P(B)
 */
export declare function mergeIndependent(p1: number, p2: number): number;
/**
 * mergeEither
 * OR probability for independent events: P(A ∪ B) = P(A) + P(B) − P(A)P(B)
 */
export declare function mergeEither(p1: number, p2: number): number;

"use strict";
/**
 * probability.ts
 * Probability helpers for simulating inclusion / failure risk; pure functions only (no I/O, no side-effects).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectedValue = expectedValue;
exports.normalizeProbs = normalizeProbs;
exports.mergeIndependent = mergeIndependent;
exports.mergeEither = mergeEither;
function expectedValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        const probabilities = a;
        const values = b;
        const n = Math.min(probabilities.length, values.length);
        let sum = 0;
        for (let i = 0; i < n; i++) {
            sum += (probabilities[i] || 0) * (values[i] || 0);
        }
        return sum;
    }
    const outcomes = a;
    let s = 0;
    for (const o of outcomes)
        s += (o?.p || 0) * (o?.v || 0);
    return s;
}
/**
 * normalizeProbs
 * why this formula: L1-normalization scales non-negative components so that their sum equals 1 when total > 0;
 * preserves the zero vector as all zeros.
 */
function normalizeProbs(probs) {
    const total = probs.reduce((a, b) => a + Math.max(0, b || 0), 0);
    if (total <= 0)
        return probs.map(() => 0);
    return probs.map(p => Math.max(0, p || 0) / total);
}
/**
 * mergeIndependent
 * AND probability for independent events: P(A ∩ B) = P(A) * P(B)
 */
function mergeIndependent(p1, p2) {
    const c = (p) => Math.max(0, Math.min(1, p || 0));
    return c(p1) * c(p2);
}
/**
 * mergeEither
 * OR probability for independent events: P(A ∪ B) = P(A) + P(B) − P(A)P(B)
 */
function mergeEither(p1, p2) {
    const c = (p) => Math.max(0, Math.min(1, p || 0));
    const a = c(p1);
    const b = c(p2);
    return a + b - a * b;
}

"use strict";
/**
 * scoring.ts
 * Utility scoring primitives for decision ranking in simulation; pure functions only (no I/O, no side-effects).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logisticScore = logisticScore;
exports.boundedLinear = boundedLinear;
exports.scoreByProfit = scoreByProfit;
exports.scoreByLatency = scoreByLatency;
exports.scoreByRisk = scoreByRisk;
exports.combineScores = combineScores;
/**
 * logisticScore
 * why this formula: maps a real-valued signal into (0,1) using a logistic curve with slope k centered at x0.
 */
function logisticScore(x, k = 1, x0 = 0) {
    const e = Math.exp(-k * (x - x0));
    return 1 / (1 + e);
}
/**
 * boundedLinear
 * why this formula: simple min-max normalization to [0,1] with clamping and guard for degenerate ranges.
 */
function boundedLinear(x, min, max) {
    if (max <= min)
        return 0.5;
    const t = (x - min) / (max - min);
    return Math.max(0, Math.min(1, t));
}
/**
 * scoreByProfit
 * Map profit (bigint) to [0,1] on a log scale to compress large dynamic ranges.
 * Uses a reference scale (1e12) so that profit=1e12 ≈ 1. Negative profit → 0.
 */
function scoreByProfit(profit) {
    if (profit <= 0n)
        return 0;
    const PROFIT_REF = 1000000000000; // 1e12 in integer domain; < Number.MAX_SAFE_INTEGER
    const p = Number(profit > BigInt(PROFIT_REF) ? BigInt(PROFIT_REF) : profit);
    const num = Math.log10(1 + p);
    const den = Math.log10(1 + PROFIT_REF);
    return Math.max(0, Math.min(1, num / den));
}
/**
 * scoreByLatency
 * Inverse relation: lower latency → higher score. Uses a simple reciprocal form with scale L0.
 */
function scoreByLatency(latencyMs, L0 = 100) {
    const x = Math.max(0, latencyMs);
    const s = 1 / (1 + x / Math.max(1, L0));
    return Math.max(0, Math.min(1, s));
}
/**
 * scoreByRisk
 * Risk is assumed in [0,1]; lower risk → higher score. Clamped to [0,1].
 */
function scoreByRisk(riskScore) {
    const r = Math.max(0, Math.min(1, riskScore));
    return 1 - r;
}
/**
 * combineScores
 * Weighted geometric mean to penalize low dimensions strongly and reward balance across factors.
 * why geometric mean: it is sensitive to near-zero components (a single very low score drags the product down),
 * enforcing multi-dimensional adequacy rather than allowing one factor to dominate.
 */
function combineScores(weights, scores, eps = 1e-12) {
    const n = Math.min(weights.length, scores.length);
    if (n === 0)
        return 0;
    let wsum = 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
        const w = Math.max(0, weights[i] || 0);
        const s = Math.max(eps, Math.min(1, scores[i] || 0));
        if (w > 0) {
            acc += w * Math.log(s);
            wsum += w;
        }
    }
    if (wsum === 0)
        return 0;
    return Math.exp(acc / wsum);
}

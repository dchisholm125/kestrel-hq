/**
 * scoring.ts
 * Utility scoring primitives for decision ranking in simulation; pure functions only (no I/O, no side-effects).
 */
/**
 * logisticScore
 * why this formula: maps a real-valued signal into (0,1) using a logistic curve with slope k centered at x0.
 */
export declare function logisticScore(x: number, k?: number, x0?: number): number;
/**
 * boundedLinear
 * why this formula: simple min-max normalization to [0,1] with clamping and guard for degenerate ranges.
 */
export declare function boundedLinear(x: number, min: number, max: number): number;
/**
 * scoreByProfit
 * Map profit (bigint) to [0,1] on a log scale to compress large dynamic ranges.
 * Uses a reference scale (1e12) so that profit=1e12 ≈ 1. Negative profit → 0.
 */
export declare function scoreByProfit(profit: bigint): number;
/**
 * scoreByLatency
 * Inverse relation: lower latency → higher score. Uses a simple reciprocal form with scale L0.
 */
export declare function scoreByLatency(latencyMs: number, L0?: number): number;
/**
 * scoreByRisk
 * Risk is assumed in [0,1]; lower risk → higher score. Clamped to [0,1].
 */
export declare function scoreByRisk(riskScore: number): number;
/**
 * combineScores
 * Weighted geometric mean to penalize low dimensions strongly and reward balance across factors.
 * why geometric mean: it is sensitive to near-zero components (a single very low score drags the product down),
 * enforcing multi-dimensional adequacy rather than allowing one factor to dominate.
 */
export declare function combineScores(weights: number[], scores: number[], eps?: number): number;

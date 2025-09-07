/**
 * scoring.ts
 * Pure math functions for utility scoring; no I/O, no side-effects.
 */

/**
 * logisticScore
 * why this formula: maps a real-valued signal into (0,1) using a logistic curve with slope k centered at x0.
 */
export function logisticScore(x: number, k = 1, x0 = 0): number {
  const e = Math.exp(-k * (x - x0))
  return 1 / (1 + e)
}

/**
 * boundedLinear
 * why this formula: simple min-max normalization to [0,1] with clamping and guard for degenerate ranges.
 */
export function boundedLinear(x: number, min: number, max: number): number {
  if (max <= min) return 0.5
  const t = (x - min) / (max - min)
  return Math.max(0, Math.min(1, t))
}

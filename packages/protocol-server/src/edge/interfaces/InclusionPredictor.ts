/**
 * InclusionPredictor (public edge interface)
 * Purpose: Predict inclusion probability and target block for a bundle.
 * Seam: Public contract for private statistical models.
 * Defaults: NOOP default returns neutral probability 0.0 and no target.
 */

export type InclusionEstimate = { probability: number; targetBlock?: number }

export interface InclusionPredictor {
  /**
   * predict
   * Inputs: Bundle metadata and environment context.
   * Output: probability in [0,1] and optional target block number.
   * Determinism: Prefer deterministic given same inputs (seeded randomness only if agreed).
   * Time budget: < 5ms.
   */
  predict(meta: Record<string, unknown>): Promise<InclusionEstimate>
}

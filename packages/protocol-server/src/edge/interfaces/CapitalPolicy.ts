/**
 * CapitalPolicy (public edge interface)
 * Purpose: Enforce spend limits and capital allocation policies for submissions.
 * Seam: Public contract for private risk controls.
 * Defaults: NOOP default authorizes all bundles with zero limits.
 */

export type CapitalDecision = { authorized: boolean; reason?: string; maxGasWei?: bigint }

export interface CapitalPolicy {
  /**
   * authorize
   * Inputs: bundle metadata, current spend metrics, optional caller context.
   * Output: authorization boolean, optional reason, and optional max gas limit.
   * Determinism: Deterministic per input snapshot.
   * Time budget: < 5ms.
   */
  authorize(meta: Record<string, unknown>): Promise<CapitalDecision>
}

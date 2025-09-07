/**
 * RelayRouter (public edge interface)
 * Purpose: Choose relay(s) and submission strategy for a bundle.
 * Seam: Public contract for private routing heuristics and preferences.
 * Defaults: NOOP default selects an empty list (no submission).
 */

export type RelayHint = { name?: string; endpoint?: string; preference?: number }
export type RelayDecision = { relays: RelayHint[]; strategy?: 'primary-only' | 'fanout' }

export interface RelayRouter {
  /**
   * route
   * Inputs: Bundle metadata and optional hints.
   * Output: Ordered relay list and a strategy.
   * Determinism: Deterministic for the same inputs.
   * Time budget: < 10ms.
   */
  route(meta: Record<string, unknown>, hints?: RelayHint[]): Promise<RelayDecision>
}

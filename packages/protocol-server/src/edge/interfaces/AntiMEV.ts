/**
 * AntiMEV (public edge interface)
 * Purpose: Apply basic protections (ordering, padding, hints) to reduce MEV risk.
 * Seam: Public contract for private tactics.
 * Defaults: NOOP default returns inputs unchanged and empty tags.
 */

export type AntiMEVResult = { txs: string[]; tags: string[] }

export interface AntiMEV {
  /**
   * filterAndTag
   * Inputs: ordered raw transactions.
   * Output: possibly filtered/reordered transactions and string tags for observability.
   * Determinism: Deterministic for the same inputs.
   * Time budget: < 5ms.
   */
  filterAndTag(txs: string[]): Promise<AntiMEVResult>
}

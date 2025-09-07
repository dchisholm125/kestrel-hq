/**
 * BundleAssembler (public edge interface)
 * Purpose: Construct a relay-submittable bundle from validated trades/intents.
 * Seam: This is a public contract so private implementations can be plugged-in without changing server core.
 * Defaults: A NOOP default exists to keep the server runnable end-to-end during development.
 */

export type AssemblerInput = {
  intents: Array<{ id: string; rawTransaction?: string; txHash?: string }>
  maxGasWei?: bigint
  deadlineMs?: number
}

export type AssembledBundle = {
  /** raw transactions ready to submit, in order */
  txs: string[]
  /** arbitrary metadata useful for later stages */
  metadata?: Record<string, unknown>
}

export interface BundleAssembler {
  /**
   * assembleBundle
   * Inputs: validated intents/trades plus optional constraints (maxGas, deadline).
   * Output: ordered list of raw tx hex strings and metadata.
   * Determinism: Should be deterministic for the same input set.
   * Time budget: target < 50ms.
   */
  assembleBundle(input: AssemblerInput): Promise<AssembledBundle>
}

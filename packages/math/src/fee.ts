/**
 * fee.ts
 * Pure math functions for gas/fee accounting; no I/O, no side-effects.
 */

/**
 * computeEffectiveGasPrice
 * why this formula: effective gas price in EIP-1559 is baseFee + max(0, min(priorityTip, maxPriorityFeePerGas))
 * scaled by constraints: min with maxFeePerGas to respect the user's cap.
 */
export function computeEffectiveGasPrice(params: {
  baseFee: number
  priorityTip: number
  maxPriorityFeePerGas: number
  maxFeePerGas: number
}): number {
  const { baseFee, priorityTip, maxPriorityFeePerGas, maxFeePerGas } = params
  const tip = Math.max(0, Math.min(priorityTip, maxPriorityFeePerGas))
  const eff = Math.min(baseFee + tip, maxFeePerGas)
  return Math.max(0, eff)
}

/**
 * estimateTxCost
 * why this formula: total cost is effective gas price * gasUsed; bounded below by 0 to enforce invariants.
 */
export function estimateTxCost(effectiveGasPrice: number, gasUsed: number): number {
  const price = Math.max(0, effectiveGasPrice)
  const gas = Math.max(0, gasUsed)
  return price * gas
}

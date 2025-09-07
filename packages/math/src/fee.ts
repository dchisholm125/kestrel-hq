/**
 * fee.ts
 * Gas/fee accounting helpers for simulation and settlement; pure functions only (no I/O, no side-effects).
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

/**
 * calcEffectiveGasCost
 * Pure bigint version: cost = gasUsed * (basePricePerGas + tipPerGas), clamped to non-negative domain.
 */
export function calcEffectiveGasCost(baseGas: bigint, tip: bigint, gasPrice: bigint): bigint {
  const max0 = (x: bigint) => (x < 0n ? 0n : x)
  const gas = max0(baseGas)
  const price = max0(gasPrice)
  const t = max0(tip)
  return gas * (price + t)
}

/**
 * calcBundleFee
 * Compute the settlement fee charged for a bundle. The fee cannot exceed the gross profit and is never negative.
 * Rationale: this caps downside and ensures no over-collection when profit is small.
 */
export function calcBundleFee(profit: bigint, gasCost: bigint): bigint {
  const max0 = (x: bigint) => (x < 0n ? 0n : x)
  const p = max0(profit)
  const g = max0(gasCost)
  return p < g ? p : g
}

/**
 * rebateSplit
 * Split net-of-fee proceeds between bot and protocol.
 * Why fixed/param-driven ratio: In production this ratio is a governance/market parameter, but here it is
 * captured as a fixed basis-points constant to keep the function pure and reproducible in tests. Adjust as needed.
 */
export function rebateSplit(profit: bigint, fee: bigint): { bot: bigint; protocol: bigint } {
  const max0 = (x: bigint) => (x < 0n ? 0n : x)
  const net = max0(profit - max0(fee))
  const BPS = 10_000n
  const PROTOCOL_BPS = 2_000n // 20% protocol share by default
  const protocol = (net * PROTOCOL_BPS) / BPS
  const bot = net - protocol
  return { bot, protocol }
}

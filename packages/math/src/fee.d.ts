/**
 * fee.ts
 * Gas/fee accounting helpers for simulation and settlement; pure functions only (no I/O, no side-effects).
 */
/**
 * computeEffectiveGasPrice
 * why this formula: effective gas price in EIP-1559 is baseFee + max(0, min(priorityTip, maxPriorityFeePerGas))
 * scaled by constraints: min with maxFeePerGas to respect the user's cap.
 */
export declare function computeEffectiveGasPrice(params: {
    baseFee: number;
    priorityTip: number;
    maxPriorityFeePerGas: number;
    maxFeePerGas: number;
}): number;
/**
 * estimateTxCost
 * why this formula: total cost is effective gas price * gasUsed; bounded below by 0 to enforce invariants.
 */
export declare function estimateTxCost(effectiveGasPrice: number, gasUsed: number): number;
/**
 * calcEffectiveGasCost
 * Pure bigint version: cost = gasUsed * (basePricePerGas + tipPerGas), clamped to non-negative domain.
 */
export declare function calcEffectiveGasCost(baseGas: bigint, tip: bigint, gasPrice: bigint): bigint;
/**
 * calcBundleFee
 * Compute the settlement fee charged for a bundle. The fee cannot exceed the gross profit and is never negative.
 * Rationale: this caps downside and ensures no over-collection when profit is small.
 */
export declare function calcBundleFee(profit: bigint, gasCost: bigint): bigint;
/**
 * rebateSplit
 * Split net-of-fee proceeds between bot and protocol.
 * Why fixed/param-driven ratio: In production this ratio is a governance/market parameter, but here it is
 * captured as a fixed basis-points constant to keep the function pure and reproducible in tests. Adjust as needed.
 */
export declare function rebateSplit(profit: bigint, fee: bigint): {
    bot: bigint;
    protocol: bigint;
};

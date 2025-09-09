/**
 * BumpPolicy - Handles fee bumping for EIP-1559 Type-2 transactions
 */
export class BumpPolicy {
  private static readonly BUMP_FACTOR = 1125n / 1000n // 12.5%
  private static readonly MIN_BUMP = 1n // At least +1 wei
  private static readonly MAX_BUMPS = 3 // Cap at 3 bumps
  private static readonly MAX_FEE_GWEI = 100n // Cap maxFeePerGas at 100 gwei

  /**
   * Calculate initial EIP-1559 fees
   * @param provider - Ethers provider to get baseFee
   * @param priorityGwei - Priority fee in gwei (default 1-2)
   * @returns { maxFeePerGas: bigint, maxPriorityFeePerGas: bigint }
   */
  static async getInitialFees(provider: any, priorityGwei: number = 1): Promise<{ maxFeePerGas: bigint, maxPriorityFeePerGas: bigint }> {
    try {
      const block = await provider.getBlock('pending')
      const baseFee = block.baseFeePerGas || 1000000000n // Fallback 1 gwei
      const maxPriorityFeePerGas = BigInt(priorityGwei) * 1000000000n // priorityGwei gwei to wei
      const maxFeePerGas = (baseFee * 2n) + maxPriorityFeePerGas
      return { maxFeePerGas, maxPriorityFeePerGas }
    } catch (error) {
      console.warn('[BumpPolicy] Failed to get baseFee, using defaults:', error)
      const maxPriorityFeePerGas = 1000000000n // 1 gwei
      const maxFeePerGas = 3000000000n // 3 gwei
      return { maxFeePerGas, maxPriorityFeePerGas }
    }
  }

  /**
   * Bump fees for replacement transaction
   * @param currentMaxFee - Current maxFeePerGas
   * @param currentMaxPriority - Current maxPriorityFeePerGas
   * @param bumpCount - Number of previous bumps (to cap)
   * @returns Bumped fees or null if capped
   */
  static bumpFees(currentMaxFee: bigint, currentMaxPriority: bigint, bumpCount: number): { maxFeePerGas: bigint, maxPriorityFeePerGas: bigint } | null {
    if (bumpCount >= this.MAX_BUMPS) {
      console.warn(`[BumpPolicy] Max bumps (${this.MAX_BUMPS}) reached, not bumping further`)
      return null
    }

    const bumpedPriority = this.bumpValue(currentMaxPriority)
    const bumpedFee = this.bumpValue(currentMaxFee)

    // Cap maxFeePerGas
    const maxFeeCap = this.MAX_FEE_GWEI * 1000000000n // 100 gwei in wei
    const finalMaxFee = bumpedFee > maxFeeCap ? maxFeeCap : bumpedFee

    console.log(`[BumpPolicy] Bumped fees: priority ${currentMaxPriority} -> ${bumpedPriority}, fee ${currentMaxFee} -> ${finalMaxFee}`)
    return { maxFeePerGas: finalMaxFee, maxPriorityFeePerGas: bumpedPriority }
  }

  private static bumpValue(value: bigint): bigint {
    const bumped = (value * this.BUMP_FACTOR) / 1000n
    return bumped > value + this.MIN_BUMP ? bumped : value + this.MIN_BUMP
  }
}

export default BumpPolicy

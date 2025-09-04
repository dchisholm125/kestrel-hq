/**
 * Compute net profit (gross - gasCost) in wei.
 * Accepts bigint or decimal string inputs and returns bigint.
 */
export function computeNetProfit(grossProfitWei: bigint | string, gasCostWei: bigint | string): bigint {
  const gross = typeof grossProfitWei === 'bigint' ? grossProfitWei : BigInt(grossProfitWei || '0')
  const gas = typeof gasCostWei === 'bigint' ? gasCostWei : BigInt(gasCostWei || '0')
  return gross - gas
}

export function toHex(value: bigint): string {
  return '0x' + value.toString(16)
}

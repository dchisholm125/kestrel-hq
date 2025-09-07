import { computeEffectiveGasPrice, estimateTxCost } from '../src/fee'

describe('fee math', () => {
  it('effective gas price respects caps and non-negativity', () => {
    const eff = computeEffectiveGasPrice({ baseFee: 30, priorityTip: 5, maxPriorityFeePerGas: 4, maxFeePerGas: 40 })
    expect(eff).toBe(34)
    const eff2 = computeEffectiveGasPrice({ baseFee: 30, priorityTip: -10, maxPriorityFeePerGas: 4, maxFeePerGas: 40 })
    expect(eff2).toBe(30)
    const eff3 = computeEffectiveGasPrice({ baseFee: 30, priorityTip: 100, maxPriorityFeePerGas: 4, maxFeePerGas: 32 })
    expect(eff3).toBe(32)
  })
  it('tx cost is price * gas, clamped to >= 0', () => {
    expect(estimateTxCost(10, 21_000)).toBe(210000)
    expect(estimateTxCost(-1, 100)).toBe(0)
    expect(estimateTxCost(1, -100)).toBe(0)
  })
})

import { expect } from 'chai'
import { computeNetProfit } from '../../src/utils/profit'

describe('computeNetProfit (unit)', () => {
  it('subtracts gas from gross', () => {
    const gross = 1000n
    const gas = 300n
    expect(computeNetProfit(gross, gas)).to.equal(700n)
  })
  it('handles string inputs', () => {
    expect(computeNetProfit('500', '200')).to.equal(300n)
  })
  it('returns negative when gas > gross', () => {
    expect(computeNetProfit(100n, 250n)).to.equal(-150n)
  })
})

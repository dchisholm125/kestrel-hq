import { expect } from 'chai'
import PendingPool, { PendingTrade } from '../../src/services/PendingPool'

describe('PendingPool removeTrades (unit)', () => {
  it('removes only specified hashes', () => {
    const pool = new PendingPool()
    const mk = (i: number): PendingTrade => ({ id: 't'+i, rawTransaction: '0x'+i.toString(16), txHash: '0xhash'+i, receivedAt: Date.now() })
    const trades = [mk(1), mk(2), mk(3), mk(4)]
    trades.forEach(t => pool.addTrade(t))
    expect(pool.getTrades()).to.have.length(4)

    const removed = pool.removeTrades(['0xhash2','0xHASH4']) // test case-insensitivity
    expect(removed).to.equal(2)
    const remaining = pool.getTrades()
    expect(remaining.map(t=>t.txHash).sort()).to.deep.equal(['0xhash1','0xhash3'])
  })

  it('returns 0 when removing from empty pool', () => {
    const pool = new PendingPool()
    expect(pool.removeTrades(['0xabc'])).to.equal(0)
  })
})

import { expect } from 'chai'
import PendingPool, { PendingTrade } from '../../src/services/PendingPool'

describe('PendingPool (unit)', () => {
  it('initializes empty', () => {
    const pool = new PendingPool()
    expect(pool.getTrades()).to.deep.equal([])
  })

  it('adds and retrieves trades', () => {
    const pool = new PendingPool()
    const trade: PendingTrade = {
      id: 't1',
      rawTransaction: '0xabc123',
      txHash: '0xhash_t1',
      receivedAt: Date.now()
    }
    pool.addTrade(trade)
    const list = pool.getTrades()
    expect(list).to.have.length(1)
    expect(list[0].id).to.equal('t1')
    // ensure defensive copy (mutating returned array does not change internal array)
    list.pop()
    expect(pool.getTrades()).to.have.length(1)
  })

  it('clear empties the pool', () => {
    const pool = new PendingPool()
    pool.addTrade({ id: 'x', rawTransaction: '0xdead', txHash: '0xhash1', receivedAt: Date.now() })
    pool.clear()
    expect(pool.getTrades()).to.have.length(0)
  })

  it('prevents duplicate trades by txHash', () => {
    const pool = new PendingPool()
    const trade = { id: 'a', rawTransaction: '0xabc', txHash: '0xdup', receivedAt: Date.now() }
    pool.addTrade(trade)
    pool.addTrade({ ...trade, id: 'b' })
    expect(pool.getTrades()).to.have.length(1)
  })
})

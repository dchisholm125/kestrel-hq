import { expect } from 'chai'
import sinon from 'sinon'
import PendingPool, { PendingTrade } from '../../src/services/PendingPool'

// Minimal stub simulator interface
class StubSimulator {
  public analyze = sinon.stub<[(string)], Promise<{ decision: string; reason?: string }>>()
}

describe('PendingPool revalidation (unit)', () => {
  const STALE_MS = 6000
  let pool: PendingPool
  let sim: StubSimulator

  beforeEach(() => {
    pool = new PendingPool()
    sim = new StubSimulator()
    // default ACCEPT
    sim.analyze.resolves({ decision: 'ACCEPT' })
  })

  it('removes a stale trade that becomes unprofitable upon revalidation', async () => {
    const now = Date.now()
    const trade: PendingTrade = {
      id: 't1',
      rawTransaction: '0xabc123',
      txHash: '0xhash1',
      receivedAt: now - (STALE_MS + 100) // ensure stale
    }
    pool.addTrade(trade)
    expect(pool.getTrades().length).to.equal(1)

    // Change stub to reject AFTER staleness established
    sim.analyze.resolves({ decision: 'REJECT', reason: 'Unprofitable' })

    const summary = await pool.revalidateStale(sim as any, STALE_MS, now)
    expect(summary.checked).to.equal(1)
    expect(summary.removed).to.equal(1)
    expect(pool.getTrades().length).to.equal(0)
  })

  it('keeps fresh trades (not past threshold)', async () => {
    const now = Date.now()
    pool.addTrade({ id: 't2', rawTransaction: '0xabc', txHash: '0xhash2', receivedAt: now - 100 })
    const summary = await pool.revalidateStale(sim as any, STALE_MS, now)
    expect(summary.checked).to.equal(0)
    expect(summary.removed).to.equal(0)
    expect(pool.getTrades().length).to.equal(1)
  })

  it('retains stale trades that still ACCEPT', async () => {
    const now = Date.now()
    pool.addTrade({ id: 't3', rawTransaction: '0xabc', txHash: '0xhash3', receivedAt: now - (STALE_MS + 50) })
    sim.analyze.resolves({ decision: 'ACCEPT' })
    const summary = await pool.revalidateStale(sim as any, STALE_MS, now)
    expect(summary.checked).to.equal(1)
    expect(summary.removed).to.equal(0)
    expect(pool.getTrades().length).to.equal(1)
  })

  it('removes stale trades when simulator throws (defensive removal)', async () => {
    const now = Date.now()
    pool.addTrade({ id: 't4', rawTransaction: '0xabc', txHash: '0xhash4', receivedAt: now - (STALE_MS + 1) })
    sim.analyze.rejects(new Error('sim failure'))
    const summary = await pool.revalidateStale(sim as any, STALE_MS, now)
    expect(summary.checked).to.equal(1)
    expect(summary.removed).to.equal(1)
    expect(pool.getTrades().length).to.equal(0)
  })
})

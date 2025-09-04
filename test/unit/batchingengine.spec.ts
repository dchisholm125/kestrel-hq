import { expect } from 'chai'
import { batchingEngine } from '../../src/services/BatchingEngine'
import { PendingTrade } from '../../src/services/PendingPool'

function mk(id: string, netProfit: bigint, gas: bigint): PendingTrade & { simulation: any; gasUsed: bigint } {
  return {
    id,
    rawTransaction: '0xabc' + id,
    txHash: '0xhash' + id,
    receivedAt: Date.now(),
    gasUsed: gas,
    simulation: { netProfitWei: netProfit.toString(), gasCostWei: gas.toString() }
  }
}

describe('BatchingEngine greedy bundle (unit)', () => {
  it('selects highest profit trades within gas limit', () => {
    const trades = [
      mk('A', 1000n, 100000n),
      mk('B', 5000n, 500000n),
      mk('C', 3000n, 600000n),
      mk('D', 2000n, 450000n)
    ]
    const res = batchingEngine.createGreedyBundle(trades, 1_500_000n)
    // Order: B(5k,500k) C(3k,600k) D(2k,450k) A(1k,100k)
    // Greedy picks B (500k), C (1.1M), cannot add D (1.55M>limit), can add A (1.2M) => B,C,A
    expect(res.trades.map(t => t.id)).to.deep.equal(['B', 'C', 'A'])
    expect(res.totalGas).to.equal(500000n + 600000n + 100000n)
    expect(res.totalNetProfitWei).to.equal(5000n + 3000n + 1000n)
  })

  it('excludes a single oversized high-profit trade', () => {
    const trades = [mk('BIG', 10_000n, 3_000_000n), mk('SMALL', 1000n, 100000n)]
    const res = batchingEngine.createGreedyBundle(trades, 2_000_000n)
    expect(res.trades.map(t => t.id)).to.deep.equal(['SMALL'])
    expect(res.excluded.some(e => e.trade.id === 'BIG' && e.reason === 'exceeds_max_gas_alone')).to.be.true
  })

  it('ignores non-positive profit trades', () => {
    const trades = [mk('P1', 2000n, 200000n), mk('Z', 0n, 100000n), mk('NEG', -1n as any, 50000n)]
    const res = batchingEngine.createGreedyBundle(trades, 1_000_000n)
    expect(res.trades.map(t => t.id)).to.deep.equal(['P1'])
    expect(res.excluded.length).to.equal(2)
  })
})

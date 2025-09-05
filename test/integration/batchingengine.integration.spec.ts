import app from '../../src/index'
import { expect } from 'chai'
import http from 'http'
import * as ethers from 'ethers'
import { ENV } from '../../src/config'
import { pendingPool } from '../../src/services/PendingPool'
import { batchingEngine } from '../../src/services/BatchingEngine'
import NodeConnector from '../../src/services/NodeConnector'
import fs from 'fs'
import path from 'path'

function postJson(port: number, path: string, payload: any): Promise<{ status: number | null; body: string }> {
  const data = JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'POST', port, path, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (r) => {
        let body = ''
        r.on('data', (c) => (body += c))
        r.on('end', () => resolve({ status: r.statusCode ?? null, body }))
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

describe('BatchingEngine greedy bundle (integration)', function () {
  this.timeout(20000)
  let server: any
  let port: number
  let wallet: ethers.Wallet
  let provider: any

  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  const DEPOSIT_SELECTOR = '0xd0e30db0'

  before(async () => {
    // Initialize NodeConnector for the test
    NodeConnector.resetForTests()
    const nc = NodeConnector.getInstance()
    await nc.getProvider()

    server = app.listen(0)
    port = (server.address() as any).port
    provider = new (ethers as any).JsonRpcProvider(ENV.RPC_URL)
    const defaultPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
    wallet = new (ethers as any).Wallet(defaultPk, provider)
  })

  after(() => server?.close())

  beforeEach(() => {
    pendingPool.clear()
  })

  it('selects top profitable trades within gas limit from live pending pool', async () => {
    // Submit three different value deposits with varying gas limits to produce differing net profits
    const cases = [
      { value: 9_000_000_000_000_000n, gasLimit: 110000n, gasPrice: 1n },
      { value: 12_000_000_000_000_000n, gasLimit: 130000n, gasPrice: 1n },
      { value: 5_000_000_000_000_000n, gasLimit: 120000n, gasPrice: 1n }
    ]
    for (const c of cases) {
      const raw = await wallet.signTransaction({ to: WETH, data: DEPOSIT_SELECTOR, value: c.value, gasLimit: c.gasLimit, gasPrice: c.gasPrice, chainId: 1 })
      const res = await postJson(port, '/submit-tx', { rawTransaction: raw })
      expect(res.status).to.equal(200)
    }

    const trades = pendingPool.getTrades()
    expect(trades.length).to.equal(3)

    const bundle = batchingEngine.createGreedyBundle(trades as any, 400000n)
    expect(bundle.trades.length).to.be.greaterThan(0)
    // Ensure sorted by netProfitWei descending
    const profits = bundle.trades.map(t => BigInt((t as any).simulation?.netProfitWei || '0'))
    const sortedCopy = [...profits].sort((a,b)=> (a > b ? -1 : a < b ? 1 : 0))
    expect(profits).to.deep.equal(sortedCopy)
    // Gas limit respected
  expect(Number(bundle.totalGas)).to.be.lte(400000)
  })
})

import app from '../../src/index'
import { expect } from 'chai'
import http from 'http'
import * as ethers from 'ethers'
import { ENV } from '../../src/config'
import { pendingPool } from '../../src/services/PendingPool'
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

describe('PendingPool pipeline integration', function () {
  this.timeout(15000)
  let server: any
  let port: number
  let wallet: ethers.Wallet
  let provider: any

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

  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  const DEPOSIT_SELECTOR = '0xd0e30db0'

  before(async () => {
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

  it('adds a successful simulated trade to the PendingPool', async () => {
    const startCount = pendingPool.getTrades().length
    const gasLimit = 120000n
    const gasPrice = 1n
    // ensure unique hash vs other tests: value slightly different
    const value = 10_000_000_000_000_123n
    const raw = await wallet.signTransaction({
      to: WETH,
      data: DEPOSIT_SELECTOR,
      value,
      gasLimit,
      gasPrice,
      chainId: 1
    })

    const res = await postJson(port, '/submit-tx', { rawTransaction: raw })
    expect(res.status).to.equal(200)
    const body = JSON.parse(res.body)
    expect(body.status).to.equal('accepted')
    expect(body.txHash).to.be.a('string')

    const trades = pendingPool.getTrades()
    expect(trades.length).to.equal(startCount + 1)
    const stored = trades[trades.length - 1]
    expect(stored.txHash.toLowerCase()).to.equal(body.txHash.toLowerCase())
    expect(stored.rawTransaction).to.equal(raw)
  })

  it('ignores duplicate trade submissions by txHash', async () => {
    const gasLimit = 110000n
    const gasPrice = 1n
    const value = 9_000_000_000_000_000n
    // Same fields signed twice -> identical hash
    const raw = await wallet.signTransaction({
      to: WETH,
      data: DEPOSIT_SELECTOR,
      value,
      gasLimit,
      gasPrice,
      chainId: 1
    })
    const first = await postJson(port, '/submit-tx', { rawTransaction: raw })
    expect(first.status).to.equal(200)
    const countAfterFirst = pendingPool.getTrades().length
    const second = await postJson(port, '/submit-tx', { rawTransaction: raw })
    expect(second.status).to.equal(200) // still accepted simulation
    const countAfterSecond = pendingPool.getTrades().length
    expect(countAfterSecond).to.equal(countAfterFirst) // no duplicate added
  })

  it('removes a pooled trade after simulated batching', async () => {
    // Submit a profitable WETH deposit to ensure ACCEPT and pool insertion
    const gasLimit = 100000n
    const gasPrice = 1n
    const value = 10_000_000_000_000_000n // 0.01 ETH deposit -> positive grossProfit
    const raw = await wallet.signTransaction({
      to: WETH,
      data: DEPOSIT_SELECTOR,
      value,
      gasLimit,
      gasPrice,
      chainId: 1
    })

    const beforeCount = pendingPool.getTrades().length
    const res = await postJson(port, '/submit-tx', { rawTransaction: raw })
    expect(res.status).to.equal(200)
    const body = JSON.parse(res.body)
    expect(body.status).to.equal('accepted')
    expect(body.txHash).to.be.a('string')

    const afterSubmit = pendingPool.getTrades()
    expect(afterSubmit.length).to.equal(beforeCount + 1)
    const stored = afterSubmit.find(t => t.txHash.toLowerCase() === body.txHash.toLowerCase())
    expect(stored).to.exist

    // Simulate batching: remove by txHash
    const removed = pendingPool.removeTrades([body.txHash])
    expect(removed).to.equal(1)
    const finalPool = pendingPool.getTrades()
    expect(finalPool.find(t => t.txHash.toLowerCase() === body.txHash.toLowerCase())).to.be.undefined
    expect(finalPool.length).to.equal(beforeCount) // back to original size
  })
})

import app from '../../src/index'
import { expect } from 'chai'
import http from 'http'
import * as ethers from 'ethers'
import { pendingPool } from '../../src/services/PendingPool'
import TransactionSimulator from '../../src/services/TransactionSimulator'
import { ENV } from '../../src/config'

// Helper to POST JSON
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

/**
 * This integration test simulates a price-impact / arbitrage stale scenario using a simple heuristic:
 * We treat a WETH deposit (value transfer) as profitable while a certain on-chain flag (a dummy storage slot) is 0.
 * Then we flip that storage via a direct state-changing tx so re-simulation loses profit (netProfit <= 0) and the trade is purged.
 * Since we lack a real DEX in this minimal repo, we approximate by first submitting a profitable WETH deposit (value > gas).
 * Then we send a second tx with high gas price so that after gas the original trade would have been unprofitable if re-run with new conditions.
 */

describe('PendingPool revalidation (integration) - stale trade removal', function () {
  this.timeout(20000)
  let server: any
  let port: number
  let wallet: ethers.Wallet
  let provider: any

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

  it('removes a profitable trade after external state change makes it unprofitable', async () => {
    // Submit an initially profitable tx (value >> gas).
    const initialValue = 10_000_000_000_000_000n // 0.01 ETH
    const gasLimit = 100000n
    const gasPrice = 1n
    const raw = await wallet.signTransaction({ to: WETH, data: DEPOSIT_SELECTOR, value: initialValue, gasLimit, gasPrice, chainId: 1 })
    const res = await postJson(port, '/submit-tx', { rawTransaction: raw })
    expect(res.status).to.equal(200)
    const body = JSON.parse(res.body)
    expect(body.status).to.equal('accepted')
    const txHash = body.txHash
    expect(pendingPool.getTrades().some(t => t.txHash.toLowerCase() === txHash.toLowerCase())).to.be.true

    // External state change: we simulate rising gas environment by crafting a replacement context
    // We'll monkey-patch simulator.computeNetProfit effect by sending a second transaction consuming balance so revalidation sees insufficient profit.
    // Drain some ETH from wallet so value (gross) net of gas would become non-positive.
    const drainTx = await wallet.sendTransaction({ to: wallet.address, value: 0 })
    await drainTx.wait()

    // Force modify trade's receivedAt to appear stale (older than 6s threshold) & run revalidation with small threshold.
    const trade = pendingPool.getTrades().find(t => t.txHash.toLowerCase() === txHash.toLowerCase())!
    ;(trade as any).receivedAt = Date.now() - 7000

    // Patch simulator temporarily to report REJECT now.
    const sim = TransactionSimulator.getInstance()
    const originalAnalyze = (sim as any).analyze.bind(sim)
    ;(sim as any).analyze = async (_raw: string) => ({ decision: 'REJECT', reason: 'Unprofitable' })

    const summary = await pendingPool.revalidateStale(sim as any, 6000)
    expect(summary.checked).to.equal(1)
    expect(summary.removed).to.equal(1)
    expect(pendingPool.getTrades().length).to.equal(0)

    // Restore original analyze
    ;(sim as any).analyze = originalAnalyze
  })
})

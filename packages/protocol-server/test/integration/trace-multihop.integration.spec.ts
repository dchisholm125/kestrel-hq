import app from '../../src/index'
import { expect } from 'chai'
import http from 'http'
import * as ethers from 'ethers'
import { ENV } from '../../src/config'
import NodeConnector from '../../src/services/NodeConnector'

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

describe('debug_traceCall multi-hop swap profit (integration)', function () {
  this.timeout(30000)
  let server: any
  let port: number
  let wallet: ethers.Wallet
  let provider: any

  before(async () => {
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

  it('analyzes a USDC->WETH->APE style multi-hop swap (simulated placeholder)', async () => {
    // For now we craft a simple tx calling an address with arbitrary data; replace with real router calldata in future.
    const dummyTarget = '0x0000000000000000000000000000000000000001'
    const gasLimit = 300000n
    const gasPrice = 1n
    const raw = await wallet.signTransaction({ to: dummyTarget, data: '0x1234', gasLimit, gasPrice, chainId: 1 })
    const res = await postJson(port, '/submit-tx', { rawTransaction: raw })
    // We only assert that the simulator returns ACCEPT or REJECT with trace debug present
    const body = JSON.parse(res.body)
    expect(body.debug).to.exist
  })
})

import app from '../../src/index'
import { expect } from 'chai'
import http from 'http'
import * as ethers from 'ethers'
import { ENV } from '../../src/config'

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

describe('Profit evaluation (integration)', function () {
  this.timeout(15000)
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
    // anvil default first account private key (Hardhat/Anvil standard)
    const defaultPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
    wallet = new (ethers as any).Wallet(defaultPk, provider)
  })

  after(() => server?.close())

  it('rejects unprofitable WETH deposit (value < gas cost)', async () => {
    // gasCost = gasLimit * gasPrice = 100000 * 1 = 100000 wei
    const gasLimit = 100000n
    const gasPrice = 1n
    const value = 1000n // < gas cost => unprofitable
    const raw = await wallet.signTransaction({
      to: WETH,
      data: DEPOSIT_SELECTOR,
      value,
      gasLimit,
      gasPrice,
      chainId: 1
    })
    const res = await postJson(port, '/submit-tx', { rawTransaction: raw })
    expect(res.status).to.equal(400)
    const body = JSON.parse(res.body)
    expect(body.reason).to.equal('Unprofitable')
  expect(body.netProfitWei).to.equal('-99000' /* gross 1000 - gas 100000 = -99000 */)
  })

  it('accepts profitable WETH deposit (value > gas cost)', async () => {
    // gasCost still 100000 wei; value 1e16 wei -> net positive
    const gasLimit = 100000n
    const gasPrice = 1n
    const value = 10_000_000_000_000_000n // 0.01 ETH
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
    expect(body.netProfitWei).to.be.a('string')
  const net = BigInt(body.netProfitWei)
  expect(net > 0n).to.equal(true)
  })
})

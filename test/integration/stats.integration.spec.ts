import app from '../../src/index'
import request from 'supertest'
import MetricsTracker from '../../src/services/MetricsTracker'
import { expect } from 'chai'
import * as ethers from 'ethers'
import { ENV } from '../../src/config'

describe('/stats metrics integration', () => {
  it('tracks submissions and exposes stats', async () => {
    const metrics = MetricsTracker.getInstance()
    const baseline = metrics.getStats()

    const baselineResp = await request(app).get('/stats')
    expect(baselineResp.status).to.eq(200)

    // Create a funded wallet from anvil default key and sign two profitable (heuristic WETH deposit) txs
    const provider = new (ethers as any).JsonRpcProvider(ENV.RPC_URL)
    const defaultPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
    const wallet = new (ethers as any).Wallet(defaultPk, provider)
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

    const buildDeposit = async (nonceOffset: number, valueEth: string) => {
      const nonce = (await provider.getTransactionCount(await wallet.getAddress())) + nonceOffset
      const txReq = {
        to: WETH,
        data: '0xd0e30db0',
        value: (ethers as any).parseEther(valueEth),
        gasPrice: 1n,
        gasLimit: 110000n + BigInt(nonceOffset * 10000),
        nonce,
        chainId: (await provider.getNetwork()).chainId
      }
      return wallet.signTransaction(txReq)
    }

    const raw1 = await buildDeposit(0, '0.009')
    const raw2 = await buildDeposit(1, '0.012')

    const r1 = await request(app).post('/submit-tx').send({ rawTransaction: raw1 })
    expect(r1.status).to.eq(200)
    const r2 = await request(app).post('/submit-tx').send({ rawTransaction: raw2 })
    expect(r2.status).to.eq(200)

    // Malformed transaction (invalid hex) to force 400 validation error
    const r3 = await request(app).post('/submit-tx').send({ rawTransaction: 'nothex' })
    expect(r3.status).to.eq(400)

    const afterResp = await request(app).get('/stats')
    expect(afterResp.status).to.eq(200)
    const after = afterResp.body

    expect(after.submissionsReceived).to.eq(baseline.submissionsReceived + 3)
    expect(after.submissionsAccepted).to.eq(baseline.submissionsAccepted + 2)
    expect(after.submissionsRejected).to.eq(baseline.submissionsRejected + 1)
    expect(after.acceptanceRate).to.be.closeTo(after.submissionsAccepted / after.submissionsReceived, 0.0001)
  })
})

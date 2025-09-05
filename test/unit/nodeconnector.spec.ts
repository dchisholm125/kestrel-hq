import { expect } from 'chai'
import NodeConnector, { NodeConnectorConfig } from '../../src/services/NodeConnector'

describe('NodeConnector (unit) – multi-endpoint failover', () => {
  afterEach(() => {
    NodeConnector.resetForTests()
  })

  it('falls back to second HTTP provider when first fails health check', async () => {
    const calls: string[] = []

    // Fake HTTP provider ctor sequence
    class FakeHttpProvider {
      url: string
      constructor(url: string) { this.url = url }
      getBlockNumber(): Promise<number> {
        calls.push(this.url)
        if (this.url === 'https://bad.rpc') {
          return Promise.reject(new Error('unreachable'))
        }
        return Promise.resolve(123)
      }
    }

    // Patch ctor
    ;(NodeConnector as any).JsonRpcProviderCtor = FakeHttpProvider

    const cfg: NodeConnectorConfig = {
      httpUrls: ['https://bad.rpc', 'https://good.rpc'],
      wsUrls: []
    }

    const nc = NodeConnector.getInstance(cfg)
    const provider = await nc.getProvider()

    expect(provider).to.be.ok
    // Expect two attempts: first bad, then good
    expect(calls).to.deep.equal(['https://bad.rpc', 'https://good.rpc'])
    expect((provider as any).url).to.equal('https://good.rpc')
  })
})

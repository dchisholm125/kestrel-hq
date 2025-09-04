import { expect } from 'chai'
import NodeConnector from '../../src/services/NodeConnector'
import { ENV } from '../../src/config'

describe('NodeConnector (unit)', () => {
  afterEach(() => {
    // reset singleton between tests
    NodeConnector.resetForTests()
    // restore default ctor
    NodeConnector.WebSocketProviderCtor = (require('ethers') as any).WebSocketProvider
  })

  it('initializes provider with RPC_URL from config', async () => {
    let capturedUrl: string | null = null

    class FakeWSProvider {
      constructor(url: string) {
        capturedUrl = url
      }
      // minimal event API used by NodeConnector
      on(_event: string, _handler: (...args: unknown[]) => void) {}
      off(_event: string, _handler: (...args: unknown[]) => void) {}
    }

    // inject fake provider ctor
    NodeConnector.WebSocketProviderCtor = FakeWSProvider

    const nc = NodeConnector.getInstance()

    // wait until provider was created (connect is async)
    const provider = await nc.getProvider()

    expect(provider).to.be.ok
    expect(capturedUrl).to.equal(ENV.RPC_URL)
  })
})

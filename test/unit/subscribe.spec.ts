import { expect } from 'chai'
import NodeConnector from '../../src/services/NodeConnector'

describe('NodeConnector subscribe (unit)', () => {
  afterEach(() => {
    NodeConnector.resetForTests()
    NodeConnector.WebSocketProviderCtor = (require('ethers') as any).WebSocketProvider
  })

  it('registers the provided callback as the block handler', async () => {
    let registeredHandler: ((n: number) => void) | null = null

    class FakeWSProvider {
      async getBlockNumber() {
        return 12345
      }
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === 'block') {
          // store the handler so test can inspect
          registeredHandler = handler as (n: number) => void
        }
      }
      off(_event: string, _handler: (...args: unknown[]) => void) {}
    }

    NodeConnector.WebSocketProviderCtor = FakeWSProvider

    const nc = NodeConnector.getInstance({
      httpUrls: ['https://test.rpc'],
      wsUrls: ['wss://test.ws']
    })
    // Initialize the streaming provider first
    const provider = await nc.getStreamingProvider()
    expect(provider).to.be.ok

    const cb = (num: number) => {
      // noop
      void num
    }

    const unsubscribe = nc.subscribeToNewBlocks(cb)
    expect(registeredHandler).to.equal(cb)

    // cleanup
    unsubscribe()
  })
})

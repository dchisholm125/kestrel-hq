import { expect } from 'chai'
import NodeConnector from '../../src/services/NodeConnector'

describe('NodeConnector (integration)', function () {
  // integration tests may take longer
  this.timeout(10000)

  it('connects to a running node (anvil) and can fetch latest block number', async () => {
    // ensure fresh instance
    NodeConnector.resetForTests()

    const nc = NodeConnector.getInstance()
    const provider = await nc.getProvider()

    expect(provider).to.be.ok

    // try to fetch latest block number using common method
    let blockNumber: number | null = null
    if (typeof provider.getBlockNumber === 'function') {
      blockNumber = await provider.getBlockNumber()
    } else if (typeof provider.send === 'function') {
      // fallback to eth_blockNumber
      const hex = await provider.send('eth_blockNumber', [])
      blockNumber = Number.parseInt(String(hex), 16)
    }

    expect(blockNumber).to.be.a('number')
    expect(blockNumber).to.be.gte(0)
  })
})

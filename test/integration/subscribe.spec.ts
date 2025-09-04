import { expect } from 'chai'
import NodeConnector from '../../src/services/NodeConnector'

describe('NodeConnector subscribe (integration)', function () {
  this.timeout(15000)

  it('callback is triggered once when anvil mines a new block', async () => {
    NodeConnector.resetForTests()
    const nc = NodeConnector.getInstance()
    const provider = await nc.getProvider()

    let calls = 0
    let receivedBlock: number | null = null

    const cb = (bn: number) => {
      calls += 1
      receivedBlock = bn
    }

    const unsubscribe = nc.subscribeToNewBlocks(cb)

    // fetch current block
    let before: number
    if (typeof provider.getBlockNumber === 'function') {
      before = await provider.getBlockNumber()
    } else {
      const hex = await provider.send('eth_blockNumber', [])
      before = Number.parseInt(String(hex), 16)
    }

    // mine a new block via RPC (compatible with ganache/anvil: evm_mine)
    if (typeof provider.send === 'function') {
      await provider.send('evm_mine', [])
    } else {
      throw new Error('provider does not support send for evm_mine')
    }

    // Wait a short moment for the event to propagate
    await new Promise((r) => setTimeout(r, 500))

    expect(calls).to.equal(1)
    expect(receivedBlock).to.be.a('number')
    expect(receivedBlock).to.equal(before + 1)

    unsubscribe()
  })
})

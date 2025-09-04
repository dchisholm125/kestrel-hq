import { expect } from 'chai'
import TransactionSimulator from '../../src/services/TransactionSimulator'
import NodeConnector from '../../src/services/NodeConnector'

describe('TransactionSimulator (unit)', () => {
  beforeEach(() => {
    NodeConnector.resetForTests()
  })

  it('returns ACCEPT when eth_call succeeds', async () => {
    // Fake provider that returns success
    class FakeProvider {
      public calls: any[] = []
      async call(obj: any, block: string) {
        this.calls.push({ obj, block })
        return '0x'
      }
      on() {}
      off() {}
    }

    // Override WebSocketProviderCtor to inject fake provider instance
    class FakeWSProvider extends FakeProvider { constructor(_url: string) { super() } }
    NodeConnector.WebSocketProviderCtor = FakeWSProvider as any

    const sim = TransactionSimulator.getInstance()

    // Dynamically build a valid raw signed legacy transaction using ethers wallet
    const wallet = (new (require('ethers').Wallet)(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ))
    const raw = await wallet.signTransaction({
      to: wallet.address,
      value: 0n,
      nonce: 0,
      gasLimit: 21000n,
      gasPrice: 1n,
      chainId: 1
    })

    const res = await sim.analyze(raw)
    expect(res.decision).to.equal('ACCEPT')
  })

  it('returns REJECT when eth_call throws', async () => {
    class FakeProviderFail {
      async call() {
        const err: any = new Error('execution reverted: fail')
        err.code = 'CALL_EXCEPTION'
        throw err
      }
      on() {}
      off() {}
    }
    class FakeWSProvider extends FakeProviderFail { constructor(_url: string) { super() } }
    NodeConnector.WebSocketProviderCtor = FakeWSProvider as any

    const sim = TransactionSimulator.getInstance()
    const wallet = (new (require('ethers').Wallet)(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    ))
    const raw = await wallet.signTransaction({
      to: wallet.address,
      value: 0n,
      nonce: 0,
      gasLimit: 21000n,
      gasPrice: 1n,
      chainId: 1
    })
    const res = await sim.analyze(raw)
    expect(res.decision).to.equal('REJECT')
  })

  it('computes token balance deltas (mocked before/after)', async () => {
    // Provide deterministic balance responses: first round (before) returns 100, second round (after) returns 150
    let callCount = 0
    class FakeProviderBalances {
      async call(params: any) {
        // Detect balanceOf by 0x70a08231
        if (typeof params?.data === 'string' && params.data.startsWith('0x70a08231')) {
          callCount++
          if (callCount === 1) return '0x64' // 100
          if (callCount === 2) return '0x64' // second token (if any) just keep 100
          if (callCount === 3) return '0x96' // 150 after for first token
          if (callCount === 4) return '0x64' // still 100 for second
          return '0x0'
        }
        // main eth_call simulation success
        return '0x'
      }
      on() {}
      off() {}
    }
    class FakeWSProvider extends FakeProviderBalances { constructor(_url: string) { super() } }
    NodeConnector.WebSocketProviderCtor = FakeWSProvider as any

    const sim = TransactionSimulator.getInstance()
    const wallet = (new (require('ethers').Wallet)(
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    ))
    const raw = await wallet.signTransaction({
      to: wallet.address,
      value: 0n,
      nonce: 0,
      gasLimit: 21000n,
      gasPrice: 1n,
      chainId: 1
    })
  const res = await sim.analyze(raw)
  expect(res.decision).to.equal('REJECT')
  const rej = res as any
  expect(rej.reason).to.equal('Unprofitable')
  const keys = Object.keys(rej.deltas || {})
  expect(keys.length).to.be.greaterThan(0)
  const firstToken = keys[0]
  expect(rej.deltas[firstToken]).to.equal('50')
  })
})

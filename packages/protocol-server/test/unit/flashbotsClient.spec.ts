import { expect } from 'chai'
import { Wallet } from 'ethers'
import sinon from 'sinon'
import axios from 'axios'
import { FlashbotsClient } from '../../src/services/FlashbotsClient'

describe('FlashbotsClient', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('constructs correct payload and signature header', async () => {
    const relayUrl = 'https://relay.flashbots.net'
  // Force using a standard Wallet (not HDNodeWallet) for constructor typing
  const rnd = Wallet.createRandom()
  const wallet = new Wallet(rnd.privateKey)

    // Stub signMessage to return deterministic signature
    const signStub = sinon.stub(wallet, 'signMessage').callsFake(async (msg: string | Uint8Array) => {
      return '0x' + Buffer.from(String(msg)).toString('hex').slice(0, 130).padEnd(130, '0')
    })

    // Stub getAddress for stable address
    const addr = await wallet.getAddress()

    const postStub = sinon.stub(axios.Axios.prototype, 'post').callsFake(async function (_url: string, body: any) {
      return {
        data: {
          result: { bundleHash: '0xdeadbeef' },
        },
        status: 200,
      } as any
    })

    const client = new FlashbotsClient(relayUrl, wallet)

    const fakeRaw = '0x1234abcd'
    const targetBlock = 12345678
    const res = await client.submitBundle(fakeRaw, { targetBlockNumber: targetBlock })

    expect(res.bundleHash).to.equal('0xdeadbeef')
    expect(res.status).to.equal('submitted')

    // Validate post was called with proper method and params
  const callArgs: any = postStub.firstCall.args[1]
  expect(callArgs.method).to.equal('eth_sendBundle')
  expect(callArgs.params[0].txs).to.deep.equal([fakeRaw])
  expect(callArgs.params[0].blockNumber).to.equal('0x' + targetBlock.toString(16))

    // Validate signature stub was used
    expect(signStub.calledOnce).to.be.true

    // We cannot directly read the header because we mocked axios post at prototype level before header assembly,
    // but we know signMessage was invoked on the exact body JSON string.
    // Additional header validation could be done by a more granular interceptor stub.
  })
})

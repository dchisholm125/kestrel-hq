import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import { BloxrouteClient } from '../../src/services/BloxrouteClient'

describe('BloxrouteClient', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('constructs correct JSON-RPC body and Authorization header', async () => {
    const relayUrl = 'https://blox.example'
    const auth = 'Bearer test-token'
    const client = new BloxrouteClient(relayUrl, auth) as any

    const signedTx = '0x' + 'ab'.repeat(10)

    const postStub = sinon.stub(client.http, 'post').resolves({
      data: { jsonrpc: '2.0', id: 123, result: { bundleHash: '0xdeadbeef' } }
    } as any)

    const res = await (client as any).submitBundle(signedTx)

    expect(res).to.deep.equal({ bundleHash: '0xdeadbeef' })
    expect(postStub.calledOnce).to.be.true
  const [url, bodyRaw, configRaw] = postStub.firstCall.args
  const body: any = bodyRaw
  const config: any = configRaw
  expect(url).to.equal('')
  expect(body.method).to.equal('blxr_submit_bundle')
  expect(body.params[0].txs).to.deep.equal([signedTx])
  expect(config.headers.Authorization).to.equal(auth)
  expect(config.headers['Content-Type']).to.equal('application/json')
  })
})

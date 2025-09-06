import app from '../../src/index'
import { expect } from 'chai'
import http from 'http'
import * as ethers from 'ethers'
import { ENV } from '../../src/config'
import NodeConnector from '../../src/services/NodeConnector'
import fs from 'fs'
import path from 'path'

// Helper to POST JSON
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

describe('TransactionSimulator /submit-tx (integration)', function () {
  this.timeout(15000)

  let server: any
  let port: number
  let provider: any

  before(async () => {
    // Initialize NodeConnector for the test
    NodeConnector.resetForTests()
    const nc = NodeConnector.getInstance()
    await nc.getProvider()

    server = app.listen(0)
    port = (server.address() as any).port
    provider = new (ethers as any).JsonRpcProvider(ENV.RPC_URL)
  })
  let fundedWallet: ethers.Wallet

  before(async () => {
    server = app.listen(0)
    port = (server.address() as any).port
    provider = new (ethers as any).JsonRpcProvider(ENV.RPC_URL)
    // anvil typically exposes primary private key 0x59c6995... or similar; fetch first account & impersonate
    const accounts: string[] = await provider.send('eth_accounts', [])
    const first = accounts[0]
    // Derive a funded wallet using anvil default mnemonic/private key list if available; fallback to using first's pk via hardcoded dev key
    // Common anvil first key: 0x... (Hardhat/Anvil default) but we avoid hardcoding if possible by unlocking first account via a random wallet funding route.
    // For simplicity, just use a known default dev key which matches anvil default account[0].
    const defaultPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
    fundedWallet = new (ethers as any).Wallet(defaultPk, provider)
    if ((await fundedWallet.getAddress()).toLowerCase() !== first.toLowerCase()) {
      // If mismatch, still proceed; test may fail if key doesn't exist on chain.
      // Add a note to console for debug.
      console.warn('[integration test] defaultPk does not match first account returned by node')
    }
  })

  after(() => {
    server?.close()
  })

  it('accepts a successful simple value transfer tx', async () => {
    const recipient = ethers.Wallet.createRandom().address
    const txRequest = {
      to: recipient,
      value: (ethers as any).parseEther('0.001')
    }
    const raw = await fundedWallet.signTransaction(txRequest)

    const res = await postJson(port, '/submit-tx', { rawTransaction: raw })
    expect(res.status).to.equal(200)
    const body = JSON.parse(res.body)
    expect(body.status).to.equal('accepted')
  })

  it('rejects a reverting tx (calling non-existent function on EOA or forcing revert)', async () => {
    // Force a revert deterministically by crafting a contract creation tx with invalid opcode in init code.
    // Invalid opcode: 0xFE. Init code: PUSH1 0x00 PUSH1 0x00 INVALID -> 0x60 00 60 00 fe
    const network = await provider.getNetwork()
    const rawRevert = await fundedWallet.signTransaction({
      nonce: 1, // arbitrary; not broadcast
      gasPrice: 1n,
      gasLimit: 100000n,
      data: '0x60006000fe',
      chainId: Number(network.chainId)
    })

    const res = await postJson(port, '/submit-tx', { rawTransaction: rawRevert })
    // We expect 400 with simulation rejected
    expect(res.status).to.equal(400)
    const body = JSON.parse(res.body)
    expect(body.status).to.equal('rejected')
  })
})

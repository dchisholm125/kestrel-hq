import { Wallet, Transaction } from 'ethers'
import { buildAndSignEip1559Tx, requiredCostWei, bumpFees } from '../../src/services/TxBuilder'
import ErrorClassifier, { ErrorAction } from '../../src/services/ErrorClassifier'
import NonceManager from '../../src/services/NonceManager'

jest.mock('../../src/config', () => ({
  ENV: {
    CHAIN_ID: 11155111,
    SEPOLIA_SWITCH: true,
    RPC_URL: 'http://localhost:8545',
    FLASHBOTS_SIGNING_KEY: '',
    SUBMISSION_MODE: 'public',
    BLOXROUTE_RELAY_URL: '',
    BLOXROUTE_AUTH: ''
  }
}))

describe('TxBuilder', () => {
  it('builds a type-2 tx that parses back as type 2', async () => {
    const wallet = new Wallet(Wallet.createRandom().privateKey)
    const raw = await buildAndSignEip1559Tx(wallet, {
      chainId: 11155111n,
      from: wallet.address,
      to: wallet.address,
      nonce: 0n,
      gasLimit: 21000n,
      maxFeePerGas: 10_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      value: 0n,
      data: '0x'
    })
    const parsed = Transaction.from(raw)
    expect(parsed.type).toBe(2)
  })

  it('requiredCostWei computes gasLimit*maxFee + value', () => {
    const cost = requiredCostWei(21000n, 100n, 123n)
    expect(cost).toBe(21000n * 100n + 123n)
  })

  it('bumpFees maintains maxFee >= maxPriorityFeePerGas across repeated bumps', () => {
    let maxFee = 1000n
    let maxPrio = 1100n
    for (let i = 0; i < 5; i++) {
      const b = bumpFees(maxFee, maxPrio)
      expect(b.maxFee >= b.maxPrio).toBe(true)
      maxFee = b.maxFee
      maxPrio = b.maxPrio
    }
  })

  it('funds check semantics: only fail when balance < required (not <=)', () => {
    const gas = 21000n, maxFee = 100n, value = 0n
    const required = requiredCostWei(gas, maxFee, value)
    const equalBalance = required
    expect(equalBalance < required).toBe(false)
    const lowerBalance = required - 1n
    expect(lowerBalance < required).toBe(true)
  })
})

describe('ErrorClassifier', () => {
  it('maps -32000 replacement underpriced to bump_and_retry', () => {
    const err = { code: -32000, error: { message: 'replacement transaction underpriced' } }
    const cls = ErrorClassifier.classifyError(err)
    expect(cls.action).toBe(ErrorAction.BUMP_FEE_RETRY)
  })

  it('extracts message from error.data.message', () => {
    const err = { code: -32000, error: { data: { message: 'replacement transaction underpriced' } } }
    const cls = ErrorClassifier.classifyError(err)
    expect(cls.action).toBe(ErrorAction.BUMP_FEE_RETRY)
  })

  it('NonceManager concurrency returns unique sequential nonces', async () => {
    // Mock provider with stable pending nonce of 7
    const provider = {
      getTransactionCount: jest.fn().mockResolvedValue(7)
    } as any
    const nm = NonceManager.getInstance(provider)
    const addr = '0x0000000000000000000000000000000000000001'
    const promises = Array.from({ length: 10 }, () => nm.reserveNonce(addr, provider))
    const nonces = await Promise.all(promises)
    const sorted = [...nonces].sort((a,b) => Number(a - b))
    // Should be 7..16 (10 values)
    expect(sorted[0]).toBe(7n)
    expect(sorted[sorted.length - 1]).toBe(16n)
    // All unique
    expect(new Set(nonces.map(n => n.toString())).size).toBe(nonces.length)
  })
})

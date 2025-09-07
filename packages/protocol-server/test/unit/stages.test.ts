import 'jest'

jest.mock('../../src/fsm/transitionExecutor', () => ({
  advanceIntent: jest.fn().mockResolvedValue(undefined),
}))

import { advanceIntent } from '../../src/fsm/transitionExecutor'
import { screenIntent } from '../../src/stages/screen'
import { validateIntent } from '../../src/stages/validate'
import { enrichIntent } from '../../src/stages/enrich'
import { policyIntent } from '../../src/stages/policy'
import { IntentState } from '../../../dto/src/enums'

const mockedAdvance = advanceIntent as unknown as jest.MockedFunction<typeof advanceIntent>

beforeEach(() => {
  mockedAdvance.mockClear()
})

describe('stages', () => {
  describe('screenIntent', () => {
    it('rejects oversize payload', async () => {
      const ctx: any = { intent: { id: 'i1', bytes: 2000, payload: {} }, corr_id: 'c1', request_hash: 'h1', cfg: { limits: { maxBytes: 1000 } }, cache: { seen: async () => false } }
      await screenIntent(ctx)
      expect(mockedAdvance).toHaveBeenCalled()
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.to).toBe(IntentState.REJECTED)
      expect(call.reason.code).toBe('SCREEN_TOO_LARGE')
    })

    it('rejects replay seen', async () => {
      const ctx: any = { intent: { id: 'i2', bytes: 10, payload: {} }, corr_id: 'c2', request_hash: 'h2', cfg: { limits: { maxBytes: 1000 } }, cache: { seen: async () => true } }
      await screenIntent(ctx)
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.to).toBe(IntentState.REJECTED)
      expect(call.reason.code).toBe('SCREEN_REPLAY_SEEN')
    })

    it('advances to SCREENED on success', async () => {
      const ctx: any = { intent: { id: 'i3', bytes: 10, payload: {} }, corr_id: 'c3', request_hash: 'h3', cfg: { limits: { maxBytes: 1000 } }, cache: { seen: async () => false } }
      await screenIntent(ctx)
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.to).toBe(IntentState.SCREENED)
    })
  })

  describe('validateIntent', () => {
    it('rejects chain mismatch', async () => {
      const ctx: any = { intent: { id: 'v1', payload: { target_chain: 'other' } }, corr_id: 'c', request_hash: 'r', cfg: { chainId: 'mainnet' } }
      await validateIntent(ctx)
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.to).toBe(IntentState.REJECTED)
      expect(call.reason.code).toBe('VALIDATION_CHAIN_MISMATCH')
    })

    it('rejects bad signature when verifier missing', async () => {
      const ctx: any = { intent: { id: 'v2', payload: { signature: 'sig' } }, corr_id: 'c', request_hash: 'r', cfg: {} }
      await validateIntent(ctx)
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.reason.code).toBe('VALIDATION_SIGNATURE_FAIL')
    })

    it('advances to VALIDATED when valid', async () => {
      const ctx: any = { intent: { id: 'v3', payload: { signature: 'sig', gas_limit: 21000 } }, corr_id: 'c', request_hash: 'r', cfg: { limits: { maxGas: 1000000 } }, verifySignature: async () => true }
      await validateIntent(ctx)
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.to).toBe(IntentState.VALIDATED)
    })
  })

  describe('enrichIntent', () => {
    it('normalizes addresses and derives fee ceiling', async () => {
      const intent: any = { id: 'e1', payload: { to: '0xABCDEF', gas_limit: 1000 } }
      const ctx: any = { intent, corr_id: 'c', request_hash: 'r', cfg: { feeMultiplier: 1.5 } }
      await enrichIntent(ctx)
      // payload mutated
      expect(intent.payload.to).toBe('0xabcdef')
      expect(intent.payload.fee_ceiling).toBeDefined()
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.to).toBe(IntentState.ENRICHED)
    })
  })

  describe('policyIntent', () => {
    it('rejects disallowed account', async () => {
      const intent: any = { id: 'p1', payload: { from: 'badacct' } }
      const ctx: any = { intent, corr_id: 'c', request_hash: 'r', cfg: { policy: { allowedAccounts: ['good'] } } }
      await policyIntent(ctx)
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.to).toBe(IntentState.REJECTED)
      expect(call.reason.code).toBe('POLICY_ACCOUNT_NOT_ALLOWED')
    })

    it('rejects when queue enqueue returns false', async () => {
      const intent: any = { id: 'p2', payload: { from: 'good' } }
      const ctx: any = { intent, corr_id: 'c', request_hash: 'r', cfg: {}, queue: { capacity: 1, enqueue: async () => false } }
      await policyIntent(ctx)
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.to).toBe(IntentState.REJECTED)
      expect(call.reason.code).toBe('QUEUE_CAPACITY')
    })

    it('advances to QUEUED when enqueue succeeds', async () => {
      const intent: any = { id: 'p3', payload: { from: 'good' } }
      const ctx: any = { intent, corr_id: 'c', request_hash: 'r', cfg: {}, queue: { capacity: 1, enqueue: async () => true } }
      await policyIntent(ctx)
      const call = mockedAdvance.mock.calls[0][0]
      expect(call.to).toBe(IntentState.QUEUED)
    })
  })
})

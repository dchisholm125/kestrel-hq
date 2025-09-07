import 'jest'
import { screenIntent } from '../../src/stages/screen'
import { validateIntent } from '../../src/stages/validate'
import { enrichIntent } from '../../src/stages/enrich'
import { policyIntent } from '../../src/stages/policy'
import { IntentState } from '../../../dto/src/enums'
import { ReasonedRejection } from '../../../reasons/src/errors'


describe('stages', () => {
  describe('screenIntent', () => {
    it('rejects oversize payload', async () => {
      const ctx: any = { intent: { id: 'i1', bytes: 2000, payload: {} }, corr_id: 'c1', request_hash: 'h1', cfg: { limits: { maxBytes: 1000 } }, cache: { seen: async () => false } }
      await expect(screenIntent(ctx)).rejects.toBeInstanceOf(ReasonedRejection)
    })

    it('rejects replay seen', async () => {
      const ctx: any = { intent: { id: 'i2', bytes: 10, payload: {} }, corr_id: 'c2', request_hash: 'h2', cfg: { limits: { maxBytes: 1000 } }, cache: { seen: async () => true } }
  await expect(screenIntent(ctx)).rejects.toBeInstanceOf(ReasonedRejection)
    })

    it('advances to SCREENED on success', async () => {
      const ctx: any = { intent: { id: 'i3', bytes: 10, payload: {} }, corr_id: 'c3', request_hash: 'h3', cfg: { limits: { maxBytes: 1000 } }, cache: { seen: async () => false } }
  const r = await screenIntent(ctx)
  expect(r.next).toBe(IntentState.SCREENED)
    })
  })

  describe('validateIntent', () => {
    it('rejects chain mismatch', async () => {
      const ctx: any = { intent: { id: 'v1', payload: { target_chain: 'other' } }, corr_id: 'c', request_hash: 'r', cfg: { chainId: 'mainnet' } }
  await expect(validateIntent(ctx)).rejects.toBeInstanceOf(ReasonedRejection)
    })

    it('rejects bad signature when verifier missing', async () => {
      const ctx: any = { intent: { id: 'v2', payload: { signature: 'sig' } }, corr_id: 'c', request_hash: 'r', cfg: {} }
  await expect(validateIntent(ctx)).rejects.toBeInstanceOf(ReasonedRejection)
    })

    it('advances to VALIDATED when valid', async () => {
      const ctx: any = { intent: { id: 'v3', payload: { signature: 'sig', gas_limit: 21000 } }, corr_id: 'c', request_hash: 'r', cfg: { limits: { maxGas: 1000000 } }, verifySignature: async () => true }
  const r = await validateIntent(ctx)
  expect(r.next).toBe(IntentState.VALIDATED)
    })
  })

  describe('enrichIntent', () => {
    it('normalizes addresses and derives fee ceiling', async () => {
  const intent: any = { id: 'e1', payload: { to: '0xABCDEF', gas_limit: 1000 } }
      const ctx: any = { intent, corr_id: 'c', request_hash: 'r', cfg: { feeMultiplier: 1.5 } }
  const res = await enrichIntent(ctx)
      // payload mutated
      expect(intent.payload.to).toBe('0xabcdef')
      expect(intent.payload.fee_ceiling).toBeDefined()
  expect(res.next).toBe(IntentState.ENRICHED)
    })
  })

  describe('policyIntent', () => {
    it('rejects disallowed account', async () => {
      const intent: any = { id: 'p1', payload: { from: 'badacct' } }
      const ctx: any = { intent, corr_id: 'c', request_hash: 'r', cfg: { policy: { allowedAccounts: ['good'] } } }
  await expect(policyIntent(ctx)).rejects.toBeInstanceOf(ReasonedRejection)
    })

    it('rejects when queue enqueue returns false', async () => {
      const intent: any = { id: 'p2', payload: { from: 'good' } }
      const ctx: any = { intent, corr_id: 'c', request_hash: 'r', cfg: {}, queue: { capacity: 1, enqueue: async () => false } }
  await expect(policyIntent(ctx)).rejects.toBeInstanceOf(ReasonedRejection)
    })

    it('advances to QUEUED when enqueue succeeds', async () => {
      const intent: any = { id: 'p3', payload: { from: 'good' } }
      const ctx: any = { intent, corr_id: 'c', request_hash: 'r', cfg: {}, queue: { capacity: 1, enqueue: async () => true } }
  const res = await policyIntent(ctx)
  expect(res.next).toBe(IntentState.QUEUED)
    })
  })
})

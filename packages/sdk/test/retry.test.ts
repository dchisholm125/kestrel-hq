import { shouldRetry, retryDelay, logSubmitOutcome } from '../src/retry'
import type { ReasonCode } from '@kestrel/dto'

describe('shouldRetry policy table', () => {
  const table: Array<{ code: ReasonCode; expect: boolean }> = [
    { code: 'QUEUE_CAPACITY', expect: true },
    { code: 'NETWORK_RPC_UNAVAILABLE', expect: true },
    { code: 'CLIENT_BAD_REQUEST', expect: false },
    { code: 'VALIDATION_SIGNATURE_FAIL', expect: false },
    { code: 'POLICY_FEE_TOO_LOW', expect: false },
    { code: 'INTERNAL_ERROR', expect: false },
  ]
  for (const row of table) {
    it(`${row.code} -> ${row.expect}`, () => {
      expect(shouldRetry(row.code)).toBe(row.expect)
    })
  }
})

describe('retryDelay backoff shape', () => {
  it('non-decreasing, capped', () => {
    const code: ReasonCode = 'QUEUE_CAPACITY'
    const delays = [1,2,3,4].map(a => retryDelay(code, a, 50, 300))
    expect(delays[1]).toBeGreaterThanOrEqual(delays[0])
    expect(delays[2]).toBeGreaterThanOrEqual(delays[1])
    expect(delays[3]).toBeLessThanOrEqual(300)
  })
})

describe('console-lines', () => {
  const orig = console.info
  beforeEach(() => { (console as any).info = jest.fn() })
  afterEach(() => { (console as any).info = orig })
  it('no-retry message', async () => {
    await logSubmitOutcome({ ok: false, code: 'POLICY_FEE_TOO_LOW', attempt: 0 })
    expect((console.info as unknown as jest.Mock).mock.calls[0][0]).toContain('no retry')
  })
  it('retry message', async () => {
    await logSubmitOutcome({ ok: false, code: 'QUEUE_CAPACITY', attempt: 1, nextRetryMs: 200 })
    expect((console.info as unknown as jest.Mock).mock.calls[0][0]).toContain('retry in 200ms')
  })
})

describe('audit-writer', () => {
  it('writes JSONL line on error', async () => {
    const lines: string[] = []
    const writer = { write: async (l: string) => { lines.push(l) } }
    await logSubmitOutcome({ ok: false, code: 'QUEUE_CAPACITY', attempt: 1, nextRetryMs: 123, auditWriter: writer })
    expect(lines.length).toBe(1)
    const obj = JSON.parse(lines[0])
    expect(obj.outcome).toBe('error')
    expect(obj.next_retry_ms).toBe(123)
  })
})

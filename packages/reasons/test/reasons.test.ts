import { REASONS } from '../src/registry'
import { reason } from '../src/factory'
import { ReasonedRejection } from '../src/errors'

describe('reasons factory', () => {
  test('factory-defaults: exact match for canonical codes', () => {
    const r = reason('CLIENT_BAD_REQUEST')
    expect(r).toEqual(REASONS.CLIENT_BAD_REQUEST)
  })

  test('override-context: merges new message and context', () => {
    const r = reason('VALIDATION_GAS_BOUNDS', { message: 'custom', context: { max: 1, got: 2 } })
    expect(r.message).toBe('custom')
    expect(r.context).toEqual({ max: 1, got: 2 })
    expect(r.http_status).toBe(REASONS.VALIDATION_GAS_BOUNDS.http_status)
  })
})

describe('ReasonedRejection', () => {
  const origWarn = console.warn
  beforeEach(() => {
  ;(console as any).warn = jest.fn()
  })
  afterEach(() => {
  ;(console as any).warn = origWarn
  })

  test('error-class-shape', () => {
    const r = reason('CLIENT_EXPIRED', { context: { now: 1 } })
    const err = new ReasonedRejection(r, 'Rejecting at VALIDATE: expired')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ReasonedRejection)
    expect((err as any).terminalState).toBe('REJECTED')
    expect((console.warn as unknown as jest.Mock).mock.calls.length).toBe(1)
  })
})

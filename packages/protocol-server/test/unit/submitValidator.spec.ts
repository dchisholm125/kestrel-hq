import { expect } from 'chai'
import { validateSubmitBody } from '../../src/validators/submitValidator'

describe('validateSubmitBody', () => {
  it('returns error for empty body', () => {
    const res = validateSubmitBody(null)
    expect(res.valid).to.equal(false)
    expect((res as any).error).to.be.a('string')
  })

  it('returns error when rawTransaction missing', () => {
    const res = validateSubmitBody({ foo: 'bar' })
    expect(res.valid).to.equal(false)
    expect((res as any).error).to.match(/rawTransaction/)
  })

  it('returns error for non-hex rawTransaction', () => {
    const res = validateSubmitBody({ rawTransaction: 'nothex' })
    expect(res.valid).to.equal(false)
    expect((res as any).error).to.match(/rawTransaction must be a 0x-prefixed hex string/)
  })
})

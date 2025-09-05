import Logger from '../src/utils/logger'

describe('Logger', () => {
  it('formats JSON with timestamp, level, message and data', () => {
    const logger = new Logger('test')
    const out: string[] = []
    // capture console.log
    const orig = console.log
    console.log = (msg: any) => out.push(String(msg))
    try {
      logger.info('hello', { a: 1 })
    } finally {
      console.log = orig
    }
    expect(out.length).toBe(1)
    const parsed = JSON.parse(out[0])
    expect(parsed).toHaveProperty('timestamp')
    expect(parsed.level).toBe('INFO')
    expect(parsed.message).toBe('hello')
    expect(parsed.data).toEqual({ a: 1 })
    expect(parsed.logger).toBe('test')
  })
})

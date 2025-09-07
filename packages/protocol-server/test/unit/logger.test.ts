import { PassThrough } from 'stream'
import * as pino from 'pino'
import * as loggerModule from '../../src/utils/logger'

function makeCapture() {
  const stream = new PassThrough()
  const chunks: string[] = []
  stream.on('data', (c) => chunks.push(c.toString()))
  return { stream, chunks }
}

describe('logger utilities', () => {
  let capture: ReturnType<typeof makeCapture>
  let originalLogger: any

  beforeEach(() => {
    capture = makeCapture()
  // replace module logger with one that writes to our stream
  originalLogger = (loggerModule as any).default
  const local = (pino as any).default ? (pino as any).default : (pino as any)
  const l = local({ level: 'info' }, capture.stream)
  ;(loggerModule as any).setLogger(l)
  })

  afterEach(() => {
    // restore by resetting to original logger if available
    if ((loggerModule as any).setLogger && originalLogger) {
      (loggerModule as any).setLogger(originalLogger)
    }
  })

  test('logTransition logs info for non-REJECTED', () => {
    loggerModule.logTransition({ intentId: 'i1', from: 'A', to: 'B', corr_id: 'c1', request_hash: 'r1', reason_code: 'X', version: 'v1', ts: '2020-01-01T00:00:00Z' })
    const out = capture.chunks.join('')
    const lines = out.split(/\n/).filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    const parsed = JSON.parse(lines[0])
    expect(parsed.event).toBe('intent.transition')
    expect(parsed.intentId).toBe('i1')
    expect(parsed.to).toBe('B')
    // info level 30
    expect(parsed.level).toBeDefined()
  })

  test('logTransition logs warn for REJECTED', () => {
    loggerModule.logTransition({ intentId: 'i2', from: 'A', to: 'REJECTED', corr_id: 'c2' })
    const out = capture.chunks.join('')
    const lines = out.split(/\n/).filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    const parsed = JSON.parse(lines[0])
    expect(parsed.event).toBe('intent.transition')
    expect(parsed.intentId).toBe('i2')
    // pino warn level is 40
    expect(parsed.level).toBeGreaterThanOrEqual(40)
  })

  test('logHttp logs http.request', () => {
    loggerModule.logHttp({ path: '/x', method: 'GET', status: 200, corr_id: 'c3', latency_ms: 12 })
    const out = capture.chunks.join('')
    const lines = out.split(/\n/).filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    const parsed = JSON.parse(lines[0])
    expect(parsed.event).toBe('http.request')
    expect(parsed.path).toBe('/x')
    expect(parsed.status).toBe(200)
  })
})

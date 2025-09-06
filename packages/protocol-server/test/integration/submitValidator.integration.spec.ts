import app from '../../src/index'
import { expect } from 'chai'
import http from 'http'

describe('POST /submit-tx malformed (integration)', () => {
  it('returns 400 for malformed body', async () => {
    const server = app.listen(0)
    const addr = server.address() as any
    const port = addr.port

    const payload = JSON.stringify({ foo: 'bar' })

    const res = await new Promise<{ status: number | null; body: string }>((resolve, reject) => {
      const req = http.request(
        { method: 'POST', port, path: '/submit-tx', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        (r) => {
          let body = ''
          r.on('data', (c) => (body += c))
          r.on('end', () => resolve({ status: r.statusCode ?? null, body }))
        }
      )
      req.on('error', reject)
      req.write(payload)
      req.end()
    })

    server.close()

    expect(res.status).to.equal(400)
  })
})

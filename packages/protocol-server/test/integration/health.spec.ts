import app from '../../src/index'
import { expect } from 'chai'
import http from 'http'

describe('GET /health (integration)', () => {
  it('returns 200 and { status: "OK" }', async () => {
    const server = app.listen(0)
    const addr = server.address() as any
    const port = addr.port

    const res = await new Promise<{ status: number | null; body: string }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, (r) => {
        let body = ''
        r.on('data', (c) => (body += c))
        r.on('end', () => resolve({ status: r.statusCode ?? null, body }))
      }).on('error', reject)
    })

    server.close()

    expect(res.status).to.equal(200)
    expect(JSON.parse(res.body)).to.deep.equal({ status: 'OK' })
  })
})

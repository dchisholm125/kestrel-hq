const request = require('supertest')
const path = require('path')
const fs = require('fs')

const builtIndex = path.resolve(__dirname, '../../protocol-server/dist/protocol-server/src/index.js')
const useDist = fs.existsSync(builtIndex)
const basePath = useDist ? '../../protocol-server/dist/protocol-server/src' : '../../protocol-server/src'

async function main() {
  try {
    const app = require(basePath + '/index').default
    console.log('Loaded app from', basePath)
    // POST /v1/submit-intent
    console.log('\nPOST /v1/submit-intent')
    const body = { intent_id: 'dbg-1', target_chain: 'eth-mainnet', deadline_ms: Date.now() + 10000 }
    const res = await request(app).post('/v1/submit-intent').set('Content-Type', 'application/json').set('X-Kestrel-ApiKey', 'k').set('X-Kestrel-Timestamp', Date.now().toString()).set('X-Kestrel-Signature', 'bad').send(body)
    console.log('status:', res.status)
    console.log('body:', res.body)

    console.log('\nGET /metrics')
    const m = await request(app).get('/metrics')
    console.log('status:', m.status)
    console.log('text:', m.text.slice(0, 400))
  } catch (e) {
    console.error('debug script error', e)
    process.exit(1)
  }
}

main()

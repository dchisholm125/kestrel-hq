/* This integration test is meant to verify the end-to-end functionality of the Protocol SDK
   by spinning up a local instance of the protocol server and making requests to it. */

const { ProtocolSDK } = require('./dist/index')
const { spawn } = require('child_process')
const fetch = require('node-fetch')
const path = require('path')

async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

async function run(){
  // start server with API_SECRET
  const serverPath = path.join(__dirname, '..','protocol-server','dist','src','index.js')
  const server = spawn('node', [serverPath], {
    env: Object.assign({}, process.env, { API_SECRET: 's3cret', SKIP_SIGNATURE_CHECK: '0' }),
    stdio: ['ignore','pipe','pipe']
  })
  server.stdout.on('data', d=>process.stdout.write('[server] '+d))
  server.stderr.on('data', d=>process.stderr.write('[server-err] '+d))
  await sleep(400)

  const sdk = new ProtocolSDK({ baseUrl: 'http://localhost:4000', apiKey: 'k', apiSecret: 's3cret' })
  const intent = { intent_id: 'itest1', target_chain: 'eth-mainnet', deadline_ms: Date.now()+60000 }
  const res1 = await sdk.submitIntent(intent, { idempotencyKey: 'id1' })
  console.log('first submit', res1)
  const res2 = await sdk.submitIntent(intent, { idempotencyKey: 'id1' })
  console.log('second submit (idempotent)', res2)
  const status = await sdk.status('itest1')
  console.log('status', status)

  server.kill()
}

run().catch(e=>{console.error(e); process.exit(1)})

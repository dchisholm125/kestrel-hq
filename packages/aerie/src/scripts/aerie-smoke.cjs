#!/usr/bin/env node

const { spawn } = require('child_process')
const path = require('path')

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('bash', ['-lc', cmd], Object.assign({ stdio: 'inherit' }, opts))
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error('exit ' + code))))
  })
}

async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

async function main(){
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
  const sdkPkg = path.join(repoRoot, 'packages', 'protocol-sdk')
  const serverPkg = path.join(repoRoot, 'packages', 'protocol-server')

  console.log('repoRoot=', repoRoot)
  console.log('sdkPkg=', sdkPkg)
  console.log('serverPkg=', serverPkg)

  console.log('Building protocol-sdk...')
  await run(`cd ${sdkPkg} && npm install --silent || true && ./node_modules/.bin/tsc -p tsconfig.json`)
  console.log('Building protocol-server...')
  await run(`cd ${serverPkg} && npm install --silent || true && ./node_modules/.bin/tsc -p tsconfig.json`)

  const serverPath = path.join(serverPkg, 'dist', 'src', 'index.js')
  console.log('Starting protocol-server...')
  const server = spawn('node',[serverPath],{ env: Object.assign({}, process.env, { API_SECRET: 's3cret', SKIP_SIGNATURE_CHECK: '0' }), stdio:['ignore','pipe','pipe'] })
  server.stdout.on('data', d=>process.stdout.write('[server] '+d))
  server.stderr.on('data', d=>process.stderr.write('[server-err] '+d))
  await sleep(500)

  const sdkPath = path.join(sdkPkg, 'dist', 'index.js')
  console.log('sdkPath=', sdkPath)
  let ProtocolSDK
  try {
    ProtocolSDK = require(sdkPath).ProtocolSDK
  } catch (err) {
    console.error('Failed to require SDK at', sdkPath, err)
    server.kill()
    process.exit(1)
  }

  const sdk = new ProtocolSDK({ baseUrl: 'http://localhost:4000', apiKey: 'aerie', apiSecret: 's3cret' })
  const intent = { intent_id: 'aerie-smoke', target_chain: 'eth-mainnet', deadline_ms: Date.now()+60000 }

  console.log('Submitting intent...')
  let res
  try {
    res = await sdk.submitIntent(intent)
  } catch (err) {
    console.error('submitIntent failed', err)
    server.kill()
    process.exit(1)
  }
  console.log('submit response:', { request_hash: res.request_hash, correlation_id: res.correlation_id })

  const start = Date.now()
  let status = null
  while (Date.now() - start < 15000) {
    try {
      status = await sdk.status(intent.intent_id)
      if (status.state === 'RECEIVED') break
    } catch (e) {
      // ignore
    }
    await sleep(500)
  }

  if (!status) {
    console.error('Failed to get status')
    server.kill()
    process.exit(1)
  }

  console.log('status:', status)
  console.log('Done — correlation_id:', status.correlation_id, 'request_hash:', res.request_hash)

  server.kill()
}

main().catch(e=>{console.error(e); process.exit(1)})

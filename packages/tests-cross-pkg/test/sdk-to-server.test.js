#!/usr/bin/env node
const fetch = require('node-fetch')
const crypto = require('crypto')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// Basic integration test script that:
// 1. Ensures protocol-server is built and started
// 2. Ensures protocol-sdk is built
// 3. Uses the SDK package to submit an intent to the running server twice and verifies idempotency
// 4. Checks /metrics and logs for expected entries

// Resolve to packages/* (two levels up from tests-cross-pkg/test)
const serverPkg = path.resolve(__dirname, '..', '..', 'protocol-server')
const sdkPkg = path.resolve(__dirname, '..', '..', 'protocol-sdk')

function run(cmd, args, opts = {}) {
  // run via shell to ensure executables like `npm` are resolved on PATH
  return spawn(cmd, args, Object.assign({ stdio: 'inherit', shell: true }, opts))
}

function buildPackage(pkgDir) {
  return new Promise((resolve, reject) => {
  // If package already has a built dist, skip rebuilding for speed and reliability in this environment.
  const distPath = require('path').join(pkgDir, 'dist')
  if (fs.existsSync(distPath)) return resolve()
  return reject(new Error('dist not found for ' + pkgDir + ', please run a build first'))
  })
}

async function startServer(pkgDir) {
  // start the server in background
  const node = process.platform === 'win32' ? 'node.exe' : 'node'
  const entry = require('path').join(pkgDir, 'dist', 'src', 'index.js')
  // Start the server using the 'node' executable from PATH to avoid absolute execPath issues
  const proc = spawn('node', [entry], { cwd: pkgDir, env: Object.assign({}, process.env, { SKIP_SIGNATURE_CHECK: '1' }), stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', d => process.stdout.write('[server] ' + d))
  proc.stderr.on('data', d => process.stderr.write('[server] ' + d))
  // wait for server to print "Server running" or timeout
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server start timeout')), 5000)
    proc.stdout.on('data', chunk => {
      const s = chunk.toString()
      if (s.includes('Server running') || s.includes('HTTP API listening')) {
        clearTimeout(timeout)
        resolve()
      }
    })
  })
  return proc
}

function computeSignature(apiKey, secret, timestamp, body) {
  const bodySha = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const payload = [apiKey, timestamp, bodySha].join(':')
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

async function main() {
  console.log('Cross-package test: build SDK and server')
  await buildPackage(sdkPkg)
  await buildPackage(serverPkg)

  const serverProc = await startServer(serverPkg)

  try {
    const url = 'http://localhost:4000/v1/submit-intent'
    const body = { intent_id: 'cross-test-1', target_chain: 'eth-mainnet', deadline_ms: Date.now() + 60000 }
    const apiKey = 'k'
    const ts = Date.now().toString()
    const sig = computeSignature(apiKey, 's3cret', ts, body)

    console.log('Submitting first intent')
    let r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-Kestrel-ApiKey': apiKey, 'X-Kestrel-Timestamp': ts, 'X-Kestrel-Signature': sig } })
    const first = await r.json()
    if (!first.correlation_id) throw new Error('no correlation_id in first response: ' + JSON.stringify(first))
    console.log('First response ok', first.correlation_id, first.request_hash)

    console.log('Submitting second (duplicate) intent')
    r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-Kestrel-ApiKey': apiKey, 'X-Kestrel-Timestamp': ts, 'X-Kestrel-Signature': sig } })
    const second = await r.json()
    if (second.correlation_id !== first.correlation_id || second.request_hash !== first.request_hash) throw new Error('idempotency failed: ' + JSON.stringify({ first, second }))
    console.log('Idempotency verified')

    console.log('Checking /v1/status/:id')
    r = await fetch('http://localhost:4000/v1/status/' + first.intent_id)
    const status = await r.json()
    if (status.correlation_id !== first.correlation_id) throw new Error('status correlation mismatch')
    console.log('/v1/status OK', status.state)

    console.log('Checking /metrics for kestrel_intents_total')
    r = await fetch('http://localhost:4000/metrics')
    const txt = await r.text()
    if (!txt.includes('kestrel_intents_total')) throw new Error('metrics missing kestrel_intents_total')
    console.log('/metrics OK')

    console.log('Checking logs for corr_id and request_hash')
    const logPath = '/home/ubuntu/Kestrel-HQ/logs/success_log.jsonl'
    await new Promise(resolve => setTimeout(resolve, 200))
    const logs = fs.readFileSync(logPath, 'utf8').trim().split('\n')
    const last = JSON.parse(logs[logs.length - 1])
    if (!last.corr_id || !last.request_hash) throw new Error('log missing corr_id/request_hash: ' + JSON.stringify(last))
    console.log('Logs OK', last.corr_id, last.request_hash)

    console.log('Cross-package test: SUCCESS')
  } finally {
    serverProc.kill()
  }
}

main().catch(err => {
  console.error('Cross-package test failed:', err.message)
  process.exit(1)
})

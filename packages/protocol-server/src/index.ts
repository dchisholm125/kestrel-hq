// This file is the main entry point for the protocol server application, setting up the HTTP server,
// routes, and core logic for handling transaction submissions and intent management.

// It runs on port 4000 by default and exposes endpoints for health checks,
// transaction submission, and intent status retrieval.

import express, { Express, Request, Response } from 'express'
import { ENV } from './config.js'
import { validateSubmitBody } from './validators/submitValidator.js'
// Lazy-load heavy services at runtime to keep the build surface small for quick developer flow
let TransactionSimulator: any
let pendingPool: any
try {
  // require at runtime
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  TransactionSimulator = require('./services/TransactionSimulator').default
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  pendingPool = require('./services/PendingPool').pendingPool
} catch (e) {
  // It's OK if these are not present during a trimmed compile; runtime will throw if used incorrectly
  TransactionSimulator = null
  pendingPool = null
}
import FileLogger from './utils/fileLogger'
import { IntentState } from '@kestrel-hq/dto'
import { intentFSM } from './services/IntentFSM'
const fileLogger = FileLogger.getInstance()
import MetricsTracker from './services/MetricsTracker'
import { ulid } from 'ulid'
import { validateSubmitIntent } from './validators/submitIntentValidator'
import { intentStore } from './services/IntentStore'
import { getReason } from '@kestrel-hq/dto'
import { ErrorEnvelope } from '@kestrel-hq/dto'
import crypto from 'crypto'
import { screenIntent } from './stages/screen'
import { validateIntent } from './stages/validate'
import { enrichIntent } from './stages/enrich'
import { policyIntent } from './stages/policy'
import { ReasonedRejection } from '@kestrel-hq/reasons'
import { appendRejection } from './utils/rejectionAudit'
import { advanceIntent } from './fsm/transitionExecutor'
import { getEdgeModules } from './edge/loader'
import { submitPath } from './pipeline/submitPath'

// Colorful logging utilities
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m'
}

function logIntent(label: string, intentId: string, corrId: string, details?: any) {
  const timestamp = new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${colors.bright}${colors.blue}📋 INTENT${colors.reset} ${label} ${colors.yellow}${intentId.slice(0, 8)}...${colors.reset} ${colors.magenta}${corrId.slice(0, 12)}...${colors.reset}${details ? ' ' + JSON.stringify(details) : ''}`)
}

function logStage(stage: string, intentId: string, status: 'START' | 'PASS' | 'FAIL', details?: any) {
  const timestamp = new Date().toISOString().slice(11, 23)
  const color = status === 'PASS' ? colors.green : status === 'FAIL' ? colors.red : colors.yellow
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '▶️'
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${colors.bright}${color}🔄 ${stage.toUpperCase()}${colors.reset} ${icon} ${colors.yellow}${intentId.slice(0, 8)}...${colors.reset}${details ? ' ' + JSON.stringify(details) : ''}`)
}

function logBundle(label: string, bundleId: string, details?: any) {
  const timestamp = new Date().toISOString().slice(11, 23)
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${colors.bright}${colors.magenta}📦 BUNDLE${colors.reset} ${label} ${colors.green}${bundleId.slice(0, 8)}...${colors.reset}${details ? ' ' + JSON.stringify(details) : ''}`)
}

function logFlashbots(label: string, txHash: string, status: string, details?: any) {
  const timestamp = new Date().toISOString().slice(11, 23)
  const color = status.includes('success') || status.includes('accepted') ? colors.green : status.includes('fail') || status.includes('reject') ? colors.red : colors.yellow
  const icon = status.includes('success') || status.includes('accepted') ? '🚀' : status.includes('fail') || status.includes('reject') ? '💥' : '⚡'
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${colors.bright}${color}⚡ FLASHBOTS${colors.reset} ${icon} ${label} ${colors.cyan}${txHash.slice(0, 10)}...${colors.reset} ${status}${details ? ' ' + JSON.stringify(details) : ''}`)
}

function logServer(label: string, details?: any) {
  const timestamp = new Date().toISOString().slice(11, 23)
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${colors.bright}${colors.white}🌐 SERVER${colors.reset} ${label}${details ? ' ' + JSON.stringify(details) : ''}`)
}

let app: Express
const port = ENV.API_SERVER_PORT || ENV.PORT || 3000
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const createApp = require('./http').createApp as () => Express
  app = createApp()
} catch (e) {
  app = express()
}

app.get('/health', (_req: Request, res: Response) => {
  logServer('🏥 HEALTH CHECK', { status: 'OK' })
  res.status(200).json({ status: 'OK' })
})

app.get('/', (req: Request, res: Response) => {
  logServer('🏠 ROOT ACCESS', { ip: req.ip })
  res.send('Hello, Kestrel Protocol!')
})

// parse JSON bodies
app.use(express.json())

// POST /submit-tx - receive trade submissions from bots
type SubmitTxBody = {
  to?: string
  data?: string
  value?: string | number
  from?: string
  /**
   * The signed, serialized transaction as a 0x-prefixed hex string (RLP or typed envelope).
   * This API accepts only `rawTransaction` to avoid ambiguity.
   */
  rawTransaction?: string
}

app.post('/submit-tx', (req: Request<Record<string, unknown>, Record<string, unknown>, SubmitTxBody>, res: Response) => {
  const metrics = MetricsTracker.getInstance()
  const started = Date.now()
  const body = req.body

  const result = validateSubmitBody(body)
  if (!result.valid) {
    metrics.incrementRejected()
    metrics.incrementReceived() // counted as received even if invalid
    metrics.recordProcessingTime(Date.now() - started)
    return res.status(400).json({ error: result.error })
  }
  metrics.incrementReceived()

  // start screening stage timer
  const screeningStart = Date.now()

  const id = `sub_${Date.now()}_${Math.floor(Math.random() * 100000)}`
  console.info('[submit-tx] received submission', { id, rawPreview: (result.raw || '').slice(0, 20) })

  ;(async () => {
    try {
      let simRes: any
      if (!TransactionSimulator) {
        // Dev fallback: when simulator isn't available, treat as accepted with mock values
        simRes = { decision: 'ACCEPT', txHash: `0xtest_${Date.now()}`, grossProfitWei: 0, gasCostWei: 0, netProfitWei: 0, deltas: null }
      } else {
        const sim = TransactionSimulator.getInstance()
        simRes = await sim.analyze(result.raw)
      }
      if (simRes.decision === 'ACCEPT') {
        // observe screening -> simulation stage latency
        metrics.observeStage('screening', Date.now() - screeningStart)
        // Add to pending pool
        try {
          const txHash = (simRes as any).txHash || 'unknown'
          const trade = {
            id,
            rawTransaction: result.raw,
            txHash,
            receivedAt: Date.now(),
            simulation: {
              grossProfit: (simRes as any).grossProfit,
              grossProfitWei: (simRes as any).grossProfitWei,
              gasCostWei: (simRes as any).gasCostWei,
              netProfitWei: (simRes as any).netProfitWei
            }
          }
          // tag trade with key_id if provided so PendingPool metrics can use it
          if ((trade as any).key_id == null && (body as any).key_id) (trade as any).key_id = (body as any).key_id
          pendingPool.addTrade(trade)

          // JSONL success log (full simulation accept shape)
          void fileLogger.logSuccess({
            event: 'submission_accept',
            id,
            txHash,
            rawPreview: (result.raw || '').slice(0, 20),
            grossProfitWei: (simRes as any).grossProfitWei,
            gasCostWei: (simRes as any).gasCostWei,
            netProfitWei: (simRes as any).netProfitWei,
            deltas: (simRes as any).deltas,
            trade
          })
        } catch (e) {
          console.error('[submit-tx] failed adding trade to pool', e)
        }
        metrics.incrementAccepted()
        metrics.recordProcessingTime(Date.now() - started)
        return res.status(200).json({ id, status: 'accepted', simulation: 'ACCEPT', grossProfit: (simRes as any).grossProfit, grossProfitWei: (simRes as any).grossProfitWei, gasCostWei: (simRes as any).gasCostWei, netProfitWei: (simRes as any).netProfitWei, deltas: (simRes as any).deltas, txHash: (simRes as any).txHash })
      }
      // Map internal reason to external code + human message + suggestion
      const internalReason = (simRes as any).reason as string
      const revertMessage = (simRes as any).revertMessage as string | undefined
      const txHash = (simRes as any).txHash
      const codeMap: Record<string, { rejectionCode: string; rejectionReason: string; suggestion?: string }> = {
        revert: {
          rejectionCode: 'SIMULATION_REVERT',
          rejectionReason: 'The transaction reverted during simulation.',
          suggestion: revertMessage && revertMessage.includes('TRANSFER_FROM_FAILED')
            ? 'Check ERC20 allowance and balance for the token involved.'
            : 'Inspect revertMessage and underlying contract logic.'
        },
        parse_error: {
          rejectionCode: 'PARSE_ERROR',
          rejectionReason: 'The raw transaction could not be parsed.',
          suggestion: 'Ensure the rawTransaction is a signed, serialized transaction (0x-prefixed hex).'
        },
        invalid_raw_hex: {
          rejectionCode: 'INVALID_RAW_HEX',
          rejectionReason: 'The rawTransaction field is not valid hex.',
          suggestion: 'Provide a 0x-prefixed, even-length hex string.'
        },
        call_obj_error: {
          rejectionCode: 'CALL_OBJECT_ERROR',
          rejectionReason: 'Failed to construct call object for simulation.',
          suggestion: 'Verify the transaction fields (to, data, value, gas parameters).'
        },
        unsupported_provider: {
          rejectionCode: 'UNSUPPORTED_PROVIDER',
          rejectionReason: 'Underlying provider does not support eth_call.',
          suggestion: 'Use a compatible JSON-RPC endpoint with eth_call support.'
        },
        no_provider: {
          rejectionCode: 'NO_PROVIDER',
          rejectionReason: 'Could not acquire a blockchain provider.',
          suggestion: 'Confirm RPC_URL is reachable and node is running.'
        },
        unprofitable: {
          rejectionCode: 'UNPROFITABLE',
          rejectionReason: 'Net profit was not positive after gas.',
          suggestion: 'Submit only transactions with higher expected gross profit.'
        }
      }

      const mapped = codeMap[internalReason] || {
        rejectionCode: 'UNKNOWN_REJECTION',
        rejectionReason: 'The transaction was rejected for an unknown reason.',
        suggestion: 'Check simulation debug steps.'
      }

      // Enhanced logging with full context
      console.warn('[submit-tx] Guardian REJECTED submission', {
        id,
        internalReason,
        rejectionCode: mapped.rejectionCode,
        rejectionReason: mapped.rejectionReason,
        revertMessage,
        txHash,
        requestBody: body,
        grossProfitWei: (simRes as any).grossProfitWei,
        gasCostWei: (simRes as any).gasCostWei,
        netProfitWei: (simRes as any).netProfitWei
      })

      const errorPayload = {
        id,
        status: 'rejected',
        rejectionCode: mapped.rejectionCode,
        rejectionReason: mapped.rejectionReason,
        revertMessage: revertMessage || null,
        suggestion: mapped.suggestion,
        txHash,
        grossProfitWei: (simRes as any).grossProfitWei,
        gasCostWei: (simRes as any).gasCostWei,
        netProfitWei: (simRes as any).netProfitWei
      }
      // JSONL rejection log
      void fileLogger.logRejection({
        event: 'submission_reject',
        id,
        txHash,
        internalReason,
        rejectionCode: mapped.rejectionCode,
        rejectionReason: mapped.rejectionReason,
        revertMessage: revertMessage || null,
        requestBody: body,
        grossProfitWei: (simRes as any).grossProfitWei,
        gasCostWei: (simRes as any).gasCostWei,
        netProfitWei: (simRes as any).netProfitWei
      })
      metrics.incrementRejected()
      metrics.recordProcessingTime(Date.now() - started)
      return res.status(400).json(errorPayload)
    } catch (e) {
      console.error('[submit-tx] simulation failed', e)
      metrics.incrementRejected()
      metrics.recordProcessingTime(Date.now() - started)
      // JSONL failure log
      void fileLogger.logFailure({
        event: 'simulation_failure',
        id,
        rawPreview: (result.raw || '').slice(0, 20),
        error: (e as any)?.message || String(e),
        stack: (e as any)?.stack
      })
      return res.status(500).json({ error: 'simulation failed' })
    }
  })()
})

// register new endpoints for intentStore and validator

/* TESTING:

1. Compute timestamp, body-sha, and signature (Node snippet):

node -e "const crypto=require('crypto'); \
apiKey='k'; ts=Date.now().toString(); \
body={intent_id:'id2',target_chain:'eth-mainnet',deadline_ms:9999}; \
bodySha=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'); \
payload=[apiKey,ts,bodySha].join(':'); \
sig=crypto.createHmac('sha256','s3cret').update(payload).digest('hex'); \
console.log(ts); console.log(bodySha); console.log(sig); console.log(JSON.stringify(body))"

2. Call the endpoint with computed values (replace timestamp/signature with the output from step 1):

curl -v -X POST http://localhost:4000/v1/submit-intent \
  -H "Content-Type: application/json" \
  -H "X-Kestrel-ApiKey: k" \
  -H "X-Kestrel-Timestamp: <TIMESTAMP_FROM_STEP1>" \
  -H "X-Kestrel-Signature: <SIGNATURE_FROM_STEP1>" \
  -d '{"intent_id":"id2","target_chain":"eth-mainnet","deadline_ms":9999}'

3. Repeat same request to verify idempotency (should return same correlation_id/request_hash):

# same curl as above; response should match the first

*/

// POST /v1/submit-intent - idempotent intent submission
app.post('/v1/submit-intent', async (req: Request, res: Response) => {
  const metrics = MetricsTracker.getInstance()
  const started = Date.now()

  // header validation
  const apiKey = req.header('X-Kestrel-ApiKey')
  const timestamp = req.header('X-Kestrel-Timestamp')
  const signature = req.header('X-Kestrel-Signature')
  const idempotencyKey = req.header('Idempotency-Key')

  if (!apiKey || !timestamp || !signature) {
  // record and label reject
  metrics.incReject('schema')
  metrics.recordProcessingTime(Date.now() - started)
  metrics.observeDecisionLatency(Date.now() - started)
  const reason = getReason('CLIENT_BAD_REQUEST')
  const envelope: ErrorEnvelope = { corr_id: `corr_missing_${Date.now()}`, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
  return res.status(reason.http_status).json(envelope)
  }

  // body validation
  const result = validateSubmitIntent(req.body)
  if (!result.valid) {
  // schema validation failure
  metrics.incReject('schema')
  metrics.recordProcessingTime(Date.now() - started)
  metrics.observeDecisionLatency(Date.now() - started)
  const reason = getReason('VALIDATION_SCHEMA_FAIL')
  const envelope: ErrorEnvelope = { corr_id: `corr_${ulid()}`, request_hash: intentStore.computeHash(req.body), state: IntentState.REJECTED, reason: reason, ts: new Date().toISOString() }
  return res.status(reason.http_status).json(envelope)
  }

  const body = result.value as any

  // compute canonical hash
  const request_hash = intentStore.computeHash(body)

  // check idempotency key or recent hash (60s window)
  const IDEMPOTENCY_WINDOW_MS = 60 * 1000
  if (idempotencyKey) {
    const existingByKey = intentStore.getByIdempotencyKeyWithin(idempotencyKey, IDEMPOTENCY_WINDOW_MS)
    if (existingByKey) {
  // idempotency hit
  metrics.incIdempotencyHit()
  metrics.incrementReceived()
  metrics.recordProcessingTime(Date.now() - started)
  metrics.observeDecisionLatency(Date.now() - started)
  return res.status(200).json({ intent_id: existingByKey.intent_id, decision: 'accepted', reason_code: existingByKey.reason_code, request_hash: existingByKey.request_hash, status_url: `/v1/status/${existingByKey.intent_id}`, correlation_id: existingByKey.correlation_id })
    }
  }

  // idempotency: if we've already seen this hash recently, return the same stored row
  const existing = intentStore.getByHashWithin(request_hash, IDEMPOTENCY_WINDOW_MS)
  if (existing) {
  // idempotency hit by hash
  metrics.incIdempotencyHit()
  metrics.incrementReceived()
  metrics.recordProcessingTime(Date.now() - started)
  metrics.observeDecisionLatency(Date.now() - started)
  return res.status(200).json({ intent_id: existing.intent_id, decision: 'accepted', reason_code: existing.reason_code, request_hash: existing.request_hash, status_url: `/v1/status/${existing.intent_id}`, correlation_id: existing.correlation_id })
  }

  // basic signature check: HMAC-SHA256 over apiKey.timestamp.body using a test secret from ENV (in prod this would be a lookup)
  // For now accept any signature if ENV.SKIP_SIGNATURE_CHECK is truthy
  if (!ENV.SKIP_SIGNATURE_CHECK) {
    const secret = ENV.API_SECRET || 'test-secret'

    // enforce timestamp skew
    const tsNum = Number(timestamp)
    if (Number.isNaN(tsNum)) {
      metrics.incReject('stale')
      metrics.recordProcessingTime(Date.now() - started)
      metrics.observeDecisionLatency(Date.now() - started)
      const reason = getReason('CLIENT_BAD_REQUEST')
      const corr = `corr_${ulid()}`
      const envelope: ErrorEnvelope = { corr_id: corr, request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      return res.status(reason.http_status).json(envelope)
    }
    const now = Date.now()
    if (Math.abs(now - tsNum) > 30_000) {
      metrics.incReject('stale')
      metrics.recordProcessingTime(Date.now() - started)
      metrics.observeDecisionLatency(Date.now() - started)
      const reason = getReason('SCREEN_RATE_LIMIT')
      const corr = `corr_${ulid()}`
      const envelope: ErrorEnvelope = { corr_id: corr, request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      return res.status(reason.http_status).json(envelope)
    }

    // signature shape: HMAC-SHA256( apiKey || ":" || timestamp || ":" || sha256(body) )
    const bodySha = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')
    const payload = [apiKey, timestamp, bodySha].join(':')
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    if (expected !== signature) {
      metrics.incReject('denylist')
      metrics.recordProcessingTime(Date.now() - started)
      metrics.observeDecisionLatency(Date.now() - started)
      const reason = getReason('VALIDATION_SIGNATURE_FAIL')
      const corr = `corr_${ulid()}`
      const envelope: ErrorEnvelope = { corr_id: corr, request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      return res.status(reason.http_status).json(envelope)
    }
  }

  // store new row — use ULID-based correlation id
  const intent_id = body.intent_id
  const correlation_id = `corr_${ulid()}`
  const row = {
    intent_id,
    request_hash,
    correlation_id,
  state: IntentState.RECEIVED,
    reason_code: 'ok',
    received_at: Date.now(),
    payload: body,
  }
  intentStore.put(row)
  // record idempotency key mapping if provided
  if (idempotencyKey) intentStore.setIdempotencyKey(idempotencyKey, row)

  // observe decision latency and per-stage ingest latency
  const decisionMs = Date.now() - started
  metrics.observeDecisionLatency(decisionMs)
  metrics.observeStage('ingest', decisionMs)

  metrics.incrementReceived()
  metrics.incrementAccepted()
  metrics.recordProcessingTime(decisionMs)

  // structured JSONL intake log
  void fileLogger.logSuccess({
    intent_id,
    request_hash,
    corr_id: correlation_id,
    stage: 'ingest',
    lat_ms: Date.now() - started
  })

  return res.status(200).json({ intent_id, decision: 'accepted', reason_code: 'ok', request_hash, status_url: `/v1/status/${intent_id}`, correlation_id })
})

// POST /intent - simplified intake that runs the stage pipeline synchronously.
app.post('/intent', async (req: Request, res: Response) => {
  const metrics = MetricsTracker.getInstance()
  const started = Date.now()

  const body = req.body || {}
  // basic required field
  if (!body.intent_id) {
    const reason = getReason('CLIENT_BAD_REQUEST')
    const envelope: ErrorEnvelope = { corr_id: `corr_missing_${Date.now()}`, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
    logIntent('❌ MISSING INTENT_ID', 'unknown', envelope.corr_id, { body })
    return res.status(reason.http_status).json(envelope)
  }

  const intent_id = body.intent_id
  const correlation_id = `corr_${ulid()}`
  const request_hash = intentStore.computeHash(body)

  logIntent('📥 RECEIVED', intent_id, correlation_id, { hash: request_hash.slice(0, 8) })

  const row = {
    intent_id,
    request_hash,
    correlation_id,
    state: IntentState.RECEIVED,
    reason_code: 'ok',
    received_at: Date.now(),
    payload: body,
  }
  // idempotency by hash: if we've already seen this hash recently, return stored state
  const recent = intentStore.getByHash(request_hash)
  if (recent) {
    // If the stored payload is deeply equal to the incoming body, short-circuit and return current state
    const storedPayload = recent.payload
    const incomingCanonical = intentStore.computeHash(body)
    const storedCanonical = intentStore.computeHash(storedPayload)
    if (incomingCanonical === storedCanonical) {
      logIntent('♻️ IDEMPOTENT', intent_id, correlation_id, { state: recent.state, hash: request_hash.slice(0, 8) })
      return res.status(200).json({ intent_id: recent.intent_id, state: recent.state, request_hash: recent.request_hash, correlation_id: recent.correlation_id })
    }
    // same hash but different body (hash collision or replay) — mark as replay seen
    const reason = getReason('SCREEN_REPLAY_SEEN')
    const envelope = { corr_id: recent.correlation_id, request_hash: recent.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
    logIntent('🚨 REPLAY DETECTED', intent_id, correlation_id, { hash: request_hash.slice(0, 8) })
    return res.status(reason.http_status).json(envelope)
  }

  intentStore.put(row)
  logIntent('💾 STORED', intent_id, correlation_id, { state: IntentState.RECEIVED })

  // pipeline context
  const edge = await getEdgeModules()
  const ctxBase: any = {
    intent: row,
    corr_id: correlation_id,
    request_hash,
    cfg: {
      limits: { maxBytes: 1024 * 10, minDeadlineMs: 0 },
      feeMultiplier: 1.2,
    },
    cache: { seen: async (h: string) => false },
    queue: { capacity: 100, enqueue: async (_: any) => true },
    edge,
  }

  try {
    // run stages synchronously; on any REJECTED, return error envelope
    try {
      logStage('screen', intent_id, 'START')
      const r = await screenIntent(ctxBase)
      if (r?.next) await advanceIntent({ intentId: intent_id, to: r.next, corr_id: correlation_id, request_hash })
      logStage('screen', intent_id, 'PASS', { next: r?.next })
    } catch (e) {
      if (e instanceof ReasonedRejection) {
        logStage('screen', intent_id, 'FAIL', { reason: e.reason.code })
        await advanceIntent({ intentId: intent_id, to: IntentState.REJECTED, corr_id: correlation_id, request_hash, reason: e.reason })
        await appendRejection({ ts: new Date().toISOString(), corr_id: correlation_id, intent_id, stage: 'screen', reason: { code: e.reason.code, category: e.reason.category, http_status: e.reason.http_status, message: e.reason.message }, context: e.reason.context })
      } else { throw e }
    }
    let updated = intentStore.getById(intent_id)
    if (!updated) throw new Error('intent not found after screen')
    if (updated.state === IntentState.REJECTED) {
      const reason = getReason(updated.reason_code as any) || getReason('INTERNAL_ERROR')
      const envelope: ErrorEnvelope = { corr_id: updated.correlation_id, request_hash: updated.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      logIntent('❌ REJECTED', intent_id, correlation_id, { stage: 'screen', reason: reason.code })
      return res.status(reason.http_status).json(envelope)
    }

    try {
      logStage('validate', intent_id, 'START')
      const r = await validateIntent(ctxBase)
      if (r?.next) await advanceIntent({ intentId: intent_id, to: r.next, corr_id: correlation_id, request_hash })
      logStage('validate', intent_id, 'PASS', { next: r?.next })
    } catch (e) {
      if (e instanceof ReasonedRejection) {
        logStage('validate', intent_id, 'FAIL', { reason: e.reason.code })
        await advanceIntent({ intentId: intent_id, to: IntentState.REJECTED, corr_id: correlation_id, request_hash, reason: e.reason })
        await appendRejection({ ts: new Date().toISOString(), corr_id: correlation_id, intent_id, stage: 'validate', reason: { code: e.reason.code, category: e.reason.category, http_status: e.reason.http_status, message: e.reason.message }, context: e.reason.context })
      } else { throw e }
    }
    updated = intentStore.getById(intent_id)
    if (updated?.state === IntentState.REJECTED) {
      const reason = getReason(updated.reason_code as any) || getReason('INTERNAL_ERROR')
      const envelope: ErrorEnvelope = { corr_id: updated.correlation_id, request_hash: updated.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      return res.status(reason.http_status).json(envelope)
    }

    try {
      logStage('enrich', intent_id, 'START')
      const r = await enrichIntent(ctxBase)
      if (r?.next) await advanceIntent({ intentId: intent_id, to: r.next, corr_id: correlation_id, request_hash })
      logStage('enrich', intent_id, 'PASS', { next: r?.next })
    } catch (e) {
      if (e instanceof ReasonedRejection) {
        logStage('enrich', intent_id, 'FAIL', { reason: e.reason.code })
        await advanceIntent({ intentId: intent_id, to: IntentState.REJECTED, corr_id: correlation_id, request_hash, reason: e.reason })
        await appendRejection({ ts: new Date().toISOString(), corr_id: correlation_id, intent_id, stage: 'enrich', reason: { code: e.reason.code, category: e.reason.category, http_status: e.reason.http_status, message: e.reason.message }, context: e.reason.context })
      } else { throw e }
    }
    updated = intentStore.getById(intent_id)
    if (updated?.state === IntentState.REJECTED) {
      const reason = getReason(updated.reason_code as any) || getReason('INTERNAL_ERROR')
      const envelope: ErrorEnvelope = { corr_id: updated.correlation_id, request_hash: updated.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      logIntent('❌ REJECTED', intent_id, correlation_id, { stage: 'enrich', reason: reason.code })
      return res.status(reason.http_status).json(envelope)
    }

    try {
      logStage('policy', intent_id, 'START')
      const r = await policyIntent(ctxBase)
      if (r?.next) await advanceIntent({ intentId: intent_id, to: r.next, corr_id: correlation_id, request_hash })
      logStage('policy', intent_id, 'PASS', { next: r?.next })
    } catch (e) {
      if (e instanceof ReasonedRejection) {
        logStage('policy', intent_id, 'FAIL', { reason: e.reason.code })
        await advanceIntent({ intentId: intent_id, to: IntentState.REJECTED, corr_id: correlation_id, request_hash, reason: e.reason })
        await appendRejection({ ts: new Date().toISOString(), corr_id: correlation_id, intent_id, stage: 'policy', reason: { code: e.reason.code, category: e.reason.category, http_status: e.reason.http_status, message: e.reason.message }, context: e.reason.context })
      } else { throw e }
    }
    updated = intentStore.getById(intent_id)
    if (updated?.state === IntentState.REJECTED) {
      const reason = getReason(updated.reason_code as any) || getReason('INTERNAL_ERROR')
      const envelope: ErrorEnvelope = { corr_id: updated.correlation_id, request_hash: updated.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
      logIntent('❌ REJECTED', intent_id, correlation_id, { stage: 'policy', reason: reason.code })
      return res.status(reason.http_status).json(envelope)
    }

    // Post-QUEUED submission path: run the public-build guard, but do not advance state beyond QUEUED here.
    try {
      logIntent('🚀 SUBMIT PATH', intent_id, correlation_id, { stage: 'submission' })
      await submitPath({ edge, intent: { intent_id }, corr_id: correlation_id, request_hash })
      logIntent('✅ SUBMIT COMPLETE', intent_id, correlation_id)
    } catch (e) {
      if (e instanceof ReasonedRejection && e.reason.code === 'SUBMIT_NOT_ATTEMPTED') {
        logIntent('⏸️ SUBMIT SKIPPED', intent_id, correlation_id, { reason: 'not_attempted' })
        // Do not advance state; just acknowledge QUEUED (deterministic, side-effect-free public build)
      } else {
        logIntent('❌ SUBMIT ERROR', intent_id, correlation_id, { error: e instanceof Error ? e.message : String(e) })
        throw e
      }
    }

  // success: return current state (public build remains at QUEUED)
    const final = intentStore.getById(intent_id)
    logIntent('📤 RESPONSE', intent_id, correlation_id, { state: final?.state, status: 201 })
    return res.status(201).json({ intent_id, state: final?.state ?? IntentState.RECEIVED })
  } catch (e) {
    // unexpected error: mark REJECTED and return INTERNAL_ERROR
    logIntent('💥 UNEXPECTED ERROR', intent_id, correlation_id, { error: e instanceof Error ? e.message : String(e) })
    const stored = intentStore.getById(intent_id)
    if (stored) {
      stored.state = IntentState.REJECTED
      stored.reason_code = 'INTERNAL_ERROR'
      intentStore.put(stored)
    }
    const reason = getReason('INTERNAL_ERROR')
    const envelope: ErrorEnvelope = { corr_id: stored?.correlation_id ?? `corr_${ulid()}`, request_hash: stored?.request_hash, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
    logIntent('📤 ERROR RESPONSE', intent_id, correlation_id, { status: reason.http_status, reason: reason.code })
    return res.status(reason.http_status).json(envelope)
  }
})

// GET /status/:intent_id - always return state and last_reason if available
app.get('/status/:intent_id', (req: Request, res: Response) => {
  const id = req.params.intent_id
  const row = intentStore.getById(id)
  if (!row) {
    const reason = getReason('CLIENT_NOT_FOUND')
    const envelope: ErrorEnvelope = { corr_id: `corr_${ulid()}`, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
    return res.status(reason.http_status).json(envelope)
  }
  const lastReason = row.reason_code && row.reason_code !== 'ok' ? (getReason(row.reason_code as any) || null) : null
  return res.status(200).json({ intent_id: row.intent_id, state: row.state, last_reason: lastReason })
})

// GET /v1/status/:intent_id - return stored row
app.get('/v1/status/:intent_id', (req: Request, res: Response) => {
  const id = req.params.intent_id
  const row = intentStore.getById(id)
  if (!row) {
    const reason = getReason('CLIENT_NOT_FOUND')
    const envelope: ErrorEnvelope = { corr_id: `corr_${ulid()}`, state: IntentState.REJECTED, reason, ts: new Date().toISOString() }
    return res.status(reason.http_status).json(envelope)
  }
  return res.status(200).json({ intent_id: row.intent_id, state: row.state, reason_code: row.reason_code, sim_summary: null, bundle_id: null, relay_submissions: null, timestamps_ms: { received: row.received_at }, correlation_id: row.correlation_id })
})

// GET /stats - expose metrics
app.get('/stats', (_req: Request, res: Response) => {
  const metrics = MetricsTracker.getInstance()
  res.status(200).json(metrics.getStats())
})

// Prometheus metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const metrics = MetricsTracker.getInstance()
    const text = await metrics.getPromMetrics()
    res.setHeader('Content-Type', 'text/plain; version=0.0.4')
    res.status(200).send(text)
  } catch (e) {
    res.status(500).send('error collecting metrics')
  }
})

// Only start server when this file is executed directly. Export app for tests.
// In CommonJS, use require.main === module
// (Previously used import.meta.url guard when module=NodeNext)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDirectRun = typeof require !== 'undefined' && (require as any).main === module
if (isDirectRun) {
  app.listen(port, () => {
    logServer('🚀 SERVER STARTED', { port, mode: ENV.NODE_ENV || 'development', privatePlugins: process.env.KESTREL_PRIVATE_PLUGINS === '1' })
    console.log(`Server running on port ${port}`)
  })
}

export default app

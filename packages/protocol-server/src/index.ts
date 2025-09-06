import express, { Request, Response } from 'express'
import { ENV } from './config.js'
import { validateSubmitBody } from './validators/submitValidator.js'
import TransactionSimulator from './services/TransactionSimulator.js'
import { pendingPool } from './services/PendingPool.js'
import FileLogger from './utils/fileLogger'
const fileLogger = FileLogger.getInstance()
import MetricsTracker from './services/MetricsTracker.js'
import { validateSubmitIntent } from './validators/submitIntentValidator.js'
import { intentStore } from './services/IntentStore.js'
import crypto from 'crypto'

const app = express()
const port = ENV.API_SERVER_PORT || ENV.PORT || 3000

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK' })
})

app.get('/', (req: Request, res: Response) => {
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

  const id = `sub_${Date.now()}_${Math.floor(Math.random() * 100000)}`
  console.info('[submit-tx] received submission', { id, rawPreview: (result.raw || '').slice(0, 20) })

  ;(async () => {
    try {
      const sim = TransactionSimulator.getInstance()
      const simRes = await sim.analyze(result.raw)
      if (simRes.decision === 'ACCEPT') {
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
    metrics.incrementRejected()
    metrics.recordProcessingTime(Date.now() - started)
    return res.status(400).json({ reason_code: 'MISSING_HEADERS', reason_detail: 'required authentication headers missing', retryable: false, suggested_backoff_ms: 0 })
  }

  // body validation
  const result = validateSubmitIntent(req.body)
  if (!result.valid) {
    metrics.incrementRejected()
    metrics.recordProcessingTime(Date.now() - started)
    return res.status(400).json({ reason_code: 'INVALID_BODY', reason_detail: result.error, retryable: false, suggested_backoff_ms: 0 })
  }

  const body = result.value as any

  // compute canonical hash
  const request_hash = intentStore.computeHash(body)

  // idempotency: if we've already seen this hash, return the same stored row
  const existing = intentStore.getByHash(request_hash)
  if (existing) {
    metrics.incrementReceived()
    metrics.recordProcessingTime(Date.now() - started)
    return res.status(200).json({ intent_id: existing.intent_id, decision: 'accepted', reason_code: existing.reason_code, request_hash: existing.request_hash, status_url: `/v1/status/${existing.intent_id}`, correlation_id: existing.correlation_id })
  }

  // basic signature check: HMAC-SHA256 over apiKey.timestamp.body using a test secret from ENV (in prod this would be a lookup)
  // For now accept any signature if ENV.SKIP_SIGNATURE_CHECK is truthy
  if (!ENV.SKIP_SIGNATURE_CHECK) {
    const secret = ENV.API_SECRET || 'test-secret'
    const payload = [apiKey, timestamp, JSON.stringify(body)].join('.')
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    if (expected !== signature) {
      metrics.incrementRejected()
      metrics.recordProcessingTime(Date.now() - started)
      return res.status(401).json({ reason_code: 'BAD_SIGNATURE', reason_detail: 'signature mismatch', retryable: false, suggested_backoff_ms: 0 })
    }
  }

  // store new row
  const intent_id = body.intent_id
  const correlation_id = `corr_${Date.now()}_${Math.floor(Math.random() * 100000)}`
  const row = {
    intent_id,
    request_hash,
    correlation_id,
    state: 'RECEIVED',
    reason_code: 'ok',
    received_at: Date.now(),
    payload: body,
  }
  intentStore.put(row)

  metrics.incrementReceived()
  metrics.incrementAccepted()
  metrics.recordProcessingTime(Date.now() - started)

  return res.status(200).json({ intent_id, decision: 'accepted', reason_code: 'ok', request_hash, status_url: `/v1/status/${intent_id}`, correlation_id })
})

// GET /v1/status/:intent_id - return stored row
app.get('/v1/status/:intent_id', (req: Request, res: Response) => {
  const id = req.params.intent_id
  const row = intentStore.getById(id)
  if (!row) return res.status(404).json({ reason_code: 'NOT_FOUND', reason_detail: 'intent not found', retryable: false, suggested_backoff_ms: 0 })
  return res.status(200).json({ intent_id: row.intent_id, state: row.state, reason_code: row.reason_code, sim_summary: null, bundle_id: null, relay_submissions: null, timestamps_ms: { received: row.received_at }, correlation_id: row.correlation_id })
})

// GET /stats - expose metrics
app.get('/stats', (_req: Request, res: Response) => {
  const metrics = MetricsTracker.getInstance()
  res.status(200).json(metrics.getStats())
})

// Only start server when this file is executed directly. Export app for tests.
// In CommonJS, use require.main === module
// (Previously used import.meta.url guard when module=NodeNext)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDirectRun = typeof require !== 'undefined' && (require as any).main === module
if (isDirectRun) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`)
  })
}

export default app

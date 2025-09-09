import pino from 'pino'

type TransitionPayload = {
  intentId: string
  from: string
  to: string
  corr_id?: string
  request_hash?: string
  reason_code?: string
  version?: string
  ts?: string
}

type HttpPayload = {
  path: string
  method: string
  status: number
  corr_id?: string
  latency_ms?: number
}

// create default logger; tests can replace via setLogger
let logger: pino.BaseLogger = pino({ level: process.env.LOG_LEVEL || 'info' })

export function setLogger(l: pino.BaseLogger) {
  logger = l
}

export function logTransition(payload: TransitionPayload): void {
  const ts = payload.ts ?? new Date().toISOString()
  const base = {
    event: 'intent.transition',
    intentId: payload.intentId,
    from: payload.from,
    to: payload.to,
    corr_id: payload.corr_id,
    request_hash: payload.request_hash,
    reason_code: payload.reason_code,
    version: payload.version,
    ts
  }

  if (payload.to === 'REJECTED') logger.warn(base)
  else logger.info(base)
}

export function logHttp(payload: HttpPayload): void {
  const base = {
    event: 'http.request',
    path: payload.path,
    method: payload.method,
    status: payload.status,
    corr_id: payload.corr_id,
    latency_ms: payload.latency_ms
  }
  logger.info(base)
}

// Print a short, human-friendly confirmation line. This is intentionally
// concise and aimed at terminal observers (non-JSON). Tests and structured
// logging should continue to use `logHttp` for machine parsing.
export function humanConfirmHttp(payload: HttpPayload): void {
  try {
    const corr = payload.corr_id || '-'
    // eslint-disable-next-line no-console
    console.log(`[http] ${payload.method} ${payload.path} ${payload.status} corr=${corr} ${payload.latency_ms ?? '-'}ms`)
  } catch (e) {}
}

export default logger

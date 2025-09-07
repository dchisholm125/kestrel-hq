/**
 * corr middleware
 *
 * Enforces a stable correlation id for every request. If the incoming
 * request provides `x-corr-id` that value is used; otherwise a ULID-based
 * correlation id is generated. The correlation id is attached to the
 * request as `req.corr_id` and a request-scoped child logger is attached
 * as `req.log` so handlers may include it in structured logs.
 */
import { Request, Response, NextFunction } from 'express'
import { ulid } from 'ulid'
import logger from '../../utils/logger'

declare global {
  namespace Express {
    interface Request {
      corr_id?: string
      log?: typeof logger
    }
  }
}

export default function corr(req: Request, _res: Response, next: NextFunction) {
  const header = (req.header('x-corr-id') || req.header('X-Corr-Id') || '') as string
  const corr = header && header.length ? header : `corr_${ulid()}`
  req.corr_id = corr
  // attach a child logger where supported; fallback to root logger
  try {
    // pino-like child
    // @ts-ignore runtime check
    if (logger && typeof (logger as any).child === 'function') {
      try { req.log = (logger as any).child({ corr_id: corr }) } catch (e) { req.log = logger }
    } else {
      req.log = logger
    }
  } catch (e) {
    // ensure we never throw from middleware
    try { req.log = logger } catch (err) { /* swallow */ }
  }
  next()
}

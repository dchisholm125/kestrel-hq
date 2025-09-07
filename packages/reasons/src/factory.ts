/**
 * reason() factory
 * Merges a base registry entry with optional overrides.
 * Defaults come from REASONS; overrides can change `message`, `http_status`, and add `context`.
 * Adding new codes: extend REASONS in registry.ts. Keep codes stable once published to avoid breaking bots.
 */
import { ReasonDetail, ReasonCode } from '@kestrel-hq/dto'
import { REASONS } from './registry'

export type ReasonOverrides = Partial<Pick<ReasonDetail, 'message' | 'http_status' | 'context'>>

export function reason(code: ReasonCode, overrides?: ReasonOverrides): ReasonDetail {
  const base = REASONS[code]
  const context = { ...(base.context || {}), ...(overrides?.context || {}) }
  return {
    ...base,
    message: overrides?.message ?? base.message,
    http_status: overrides?.http_status ?? base.http_status,
    context: Object.keys(context).length ? context : undefined,
  }
}

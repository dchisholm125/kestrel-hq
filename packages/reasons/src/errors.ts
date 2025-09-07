/**
 * ReasonedRejection Error
 * Wraps a ReasonDetail to enforce a deterministic rejection shape across stages.
 * On construction, emits a single console.warn for observability.
 */
import { ReasonDetail } from '@kestrel/dto'

export class ReasonedRejection extends Error {
  public readonly reason: ReasonDetail
  public readonly terminalState = 'REJECTED' as const

  constructor(reason: ReasonDetail, human?: string) {
    super(reason.message)
    this.name = 'ReasonedRejection'
    this.reason = reason
    // one-line structured warning for local visibility
    try {
      const contextKeys = Object.keys(reason.context || {})
      // eslint-disable-next-line no-console
      console.warn('[reason.created]', {
        event: 'reason.created',
        code: reason.code,
        category: reason.category,
        http_status: reason.http_status,
        contextKeys,
        message: human || reason.message,
      })
    } catch (_) {}
  }
}

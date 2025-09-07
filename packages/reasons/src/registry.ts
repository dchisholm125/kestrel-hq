/**
 * Reasons Registry
 * Centralizes all machine-parsable rejection codes for Kestrel.
 * Each entry is stable and consumed by bots/dashboards to interpret failures deterministically.
 */
import { ReasonCode, ReasonCategory, ReasonDetail } from '@kestrel/dto'

import { REASONS as DTO_REASONS } from '../../dto/src/reasons'

export const REASONS: Record<ReasonCode, ReasonDetail> = DTO_REASONS

export function getReason(code: ReasonCode): ReasonDetail { return DTO_REASONS[code] }

export type { ReasonDetail }

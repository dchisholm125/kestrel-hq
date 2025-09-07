import { ReasonCode, ReasonDetail } from './enums';
export declare const REASONS: Record<ReasonCode, ReasonDetail>;
export declare function getReason(code: ReasonCode): ReasonDetail;

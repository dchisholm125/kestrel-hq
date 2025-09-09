/**
 * Private edge implementations export surface (stable names expected by public loader).
 * No side effects; exports are wrappers around Impl classes to maintain names.
 */
import { BundleAssemblerImpl } from './BundleAssembler.impl';
import { InclusionPredictorImpl } from './InclusionPredictor.impl';
import { RelayRouterImpl } from './RelayRouter.impl';
import { AntiMEVImpl } from './AntiMEV.impl';
import { CapitalPolicyImpl } from './CapitalPolicy.impl';

export class BundleAssembler extends BundleAssemblerImpl {}
export class InclusionPredictor extends InclusionPredictorImpl {}
export class RelayRouter extends RelayRouterImpl {}
export class AntiMEV extends AntiMEVImpl {}
export class CapitalPolicy extends CapitalPolicyImpl {}

// Optional helpers for wiring metrics into implementations
export type PrivateMetrics = { capsDenied: { inc: (labels?: Record<string,string>, v?: number) => void } };
export function attachMetricsToEdge(impls: { capital?: CapitalPolicyImpl }, m: PrivateMetrics){
	try { impls.capital?.attachMetrics?.(m as any); } catch {}
}

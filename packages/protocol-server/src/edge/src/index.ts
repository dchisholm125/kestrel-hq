/**
 * Private edge implementations export surface (stable names expected by public loader).
 * No side effects; exports are wrappers around Impl classes to maintain names.
 */
import { BundleAssemblerImpl } from './BundleAssembler.impl';
import { InclusionPredictorImpl } from './InclusionPredictor.impl';
import { RelayRouterImpl } from './RelayRouter.impl';
import { AntiMEVImpl } from './AntiMEV.impl';
import { CapitalPolicyImpl } from './CapitalPolicy.impl';

// Colorful logging utilities for private edge modules
export const colors = {
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

export function logBundle(label: string, bundleId: string, details?: any) {
  const timestamp = new Date().toISOString().slice(11, 23)
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${colors.bright}${colors.magenta}📦 BUNDLE${colors.reset} ${label} ${colors.green}${bundleId.slice(0, 8)}...${colors.reset}${details ? ' ' + JSON.stringify(details) : ''}`)
}

export function logFlashbots(label: string, txHash: string, status: string, details?: any) {
  const timestamp = new Date().toISOString().slice(11, 23)
  const color = status.includes('success') || status.includes('accepted') ? colors.green : status.includes('fail') || status.includes('reject') ? colors.red : colors.yellow
  const icon = status.includes('success') || status.includes('accepted') ? '🚀' : status.includes('fail') || status.includes('reject') ? '💥' : '⚡'
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${colors.bright}${color}⚡ FLASHBOTS${colors.reset} ${icon} ${label} ${colors.cyan}${txHash.slice(0, 10)}...${colors.reset} ${status}${details ? ' ' + JSON.stringify(details) : ''}`)
}

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

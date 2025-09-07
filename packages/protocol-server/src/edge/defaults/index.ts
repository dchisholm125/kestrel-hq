/**
 * Edge defaults
 * Purpose: Provide NOOP implementations for public edge interfaces so the server can run end-to-end without private add-ons.
 * Why defaults: Development ergonomics and open-source friendliness; private modules can be linked later at runtime.
 */

import type { BundleAssembler, AssemblerInput, AssembledBundle } from '../interfaces/BundleAssembler'
import type { RelayRouter, RelayDecision, RelayHint } from '../interfaces/RelayRouter'
import type { InclusionPredictor, InclusionEstimate } from '../interfaces/InclusionPredictor'
import type { AntiMEV, AntiMEVResult } from '../interfaces/AntiMEV'
import type { CapitalPolicy, CapitalDecision } from '../interfaces/CapitalPolicy'

class NoopBundleAssembler implements BundleAssembler {
  async assembleBundle(input: AssemblerInput): Promise<AssembledBundle> {
    const txs: string[] = (input.intents || [])
      .map(x => x.rawTransaction)
      .filter((x): x is string => typeof x === 'string')
    return { txs, metadata: { noop: true } }
  }
}

class NoopRelayRouter implements RelayRouter {
  async route(_meta: Record<string, unknown>, _hints?: RelayHint[]): Promise<RelayDecision> {
    return { relays: [], strategy: 'primary-only' }
  }
}

class NoopInclusionPredictor implements InclusionPredictor {
  async predict(_meta: Record<string, unknown>): Promise<InclusionEstimate> {
    return { probability: 0.0 }
  }
}

class NoopAntiMEV implements AntiMEV {
  async filterAndTag(txs: string[]): Promise<AntiMEVResult> {
    return { txs, tags: [] }
  }
}

class NoopCapitalPolicy implements CapitalPolicy {
  async authorize(_meta: Record<string, unknown>): Promise<CapitalDecision> {
    return { authorized: true }
  }
}

export const defaults = {
  BundleAssembler: new NoopBundleAssembler(),
  RelayRouter: new NoopRelayRouter(),
  InclusionPredictor: new NoopInclusionPredictor(),
  AntiMEV: new NoopAntiMEV(),
  CapitalPolicy: new NoopCapitalPolicy(),
}

export type EdgeDefaults = typeof defaults

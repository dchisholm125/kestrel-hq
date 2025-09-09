/**
 * Edge loader
 * Purpose: Dynamically load private edge modules when enabled; otherwise use NOOP defaults.
 * Public seam: Keeps server core open-source while allowing private add-ons out-of-tree.
 */

import fs from 'fs'
import path from 'path'
import { defaults } from './defaults'
import type { BundleAssembler } from './interfaces/BundleAssembler'
import type { RelayRouter } from './interfaces/RelayRouter'
import type { InclusionPredictor } from './interfaces/InclusionPredictor'
import type { AntiMEV } from './interfaces/AntiMEV'
import type { CapitalPolicy } from './interfaces/CapitalPolicy'

export type EdgeModules = {
  BundleAssembler: BundleAssembler
  RelayRouter: RelayRouter
  InclusionPredictor: InclusionPredictor
  AntiMEV: AntiMEV
  CapitalPolicy: CapitalPolicy
}

function writeAudit(mode: 'noop' | 'private', modules: string[]) {
  try {
    const dir = path.resolve(__dirname, '..', '..', 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'edge-loader.jsonl')
    const rec = { ts: new Date().toISOString(), mode, modules }
    fs.appendFileSync(file, JSON.stringify(rec) + '\n')
  } catch {}
}

async function loadPrivate(): Promise<EdgeModules | null> {
  try {
    // First try to load from local edge modules (copied)
    try {
      const localPath = path.resolve(__dirname, 'src', 'index.ts');
      // Use dynamic import for TypeScript
      const mod = await import(localPath);
      const m: any = mod?.default ?? mod;
      if (m) {
        const out: EdgeModules = {
          BundleAssembler: m.BundleAssembler ?? defaults.BundleAssembler,
          RelayRouter: m.RelayRouter ?? defaults.RelayRouter,
          InclusionPredictor: m.InclusionPredictor ?? defaults.InclusionPredictor,
          AntiMEV: m.AntiMEV ?? defaults.AntiMEV,
          CapitalPolicy: m.CapitalPolicy ?? defaults.CapitalPolicy,
        };
        return out;
      }
    } catch (localError) {
      console.log('[edge-loader] Local edge modules not found, trying package import:', (localError as Error).message);
    }

    // Fallback to package import
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await (new Function('p', 'return import(p)'))('@kestrel-protocol-private/edge')
    const m: any = mod?.default ?? mod
    if (!m) return null
    const out: EdgeModules = {
      BundleAssembler: m.BundleAssembler ?? defaults.BundleAssembler,
      RelayRouter: m.RelayRouter ?? defaults.RelayRouter,
      InclusionPredictor: m.InclusionPredictor ?? defaults.InclusionPredictor,
      AntiMEV: m.AntiMEV ?? defaults.AntiMEV,
      CapitalPolicy: m.CapitalPolicy ?? defaults.CapitalPolicy,
    }
    return out
  } catch (error) {
    console.log('[edge-loader] Failed to load private modules:', (error as Error).message);
    return null
  }
}

let cached: Promise<EdgeModules> | null = null

export function getEdgeModules(): Promise<EdgeModules> {
  if (!cached) {
    cached = (async () => {
      const usePrivate = process.env.KESTREL_PRIVATE_PLUGINS === '1'
      if (usePrivate) {
        const priv = await loadPrivate()
        if (priv) {
          try { console.info('Edge loader: loaded private plugins') } catch {}
          writeAudit('private', Object.keys(priv))
          return priv
        }
      }
      try { console.info('Edge loader: using NOOP defaults') } catch {}
      writeAudit('noop', Object.keys(defaults))
      return defaults
    })()
  }
  return cached
}

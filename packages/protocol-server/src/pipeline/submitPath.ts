/**
 * submitPath.ts
 * Public-build guard for the post-QUEUED submission path. This routes through the edge seam.
 * In public builds (NOOP defaults active), we never submit; instead we produce a SUBMIT_NOT_ATTEMPTED
 * ReasonedRejection for observability while keeping state at QUEUED (Step 2 discipline: no side effects).
 * Private builds will bypass this guard (returning without error) and handle submission elsewhere.
 */

import fs from 'fs'
import path from 'path'
import type { EdgeModules } from '../edge/loader'
import { reason, ReasonedRejection } from '@kestrel-hq/reasons'
import BundleSubmitter from '../services/BundleSubmitter'
import crypto from 'crypto'
import { Wallet, JsonRpcProvider } from 'ethers'
import { ENV } from '../config'

export type SubmitCtx = {
  edge: EdgeModules
  intent: { intent_id: string }
  corr_id: string
  request_hash: string
}

/**
 * Guard: if BundleAssembler is the NOOP default, do not submit. This keeps public builds safe and deterministic.
 * Rationale: Public distributions must not attempt real relay submissions; they should remain side-effect-free.
 */
export async function submitPath(ctx: SubmitCtx): Promise<void> {
  const { edge, intent, corr_id } = ctx
  const assembler = edge.BundleAssembler as any
  const isNoop = assembler?.constructor?.name === 'NoopBundleAssembler' || assembler?.__noop === true
  if (isNoop) {
    try { console.warn('Submission disabled in public build; returning SUBMIT_NOT_ATTEMPTED') } catch {}
    // persistent guard audit
    try {
      const dir = path.resolve(__dirname, '..', 'logs')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'submission-guard.jsonl')
      const rec = { ts: new Date().toISOString(), corr_id, intent_id: intent.intent_id, guard: 'public-noop', reason: 'SUBMIT_NOT_ATTEMPTED' }
      fs.appendFileSync(file, JSON.stringify(rec) + '\n')
    } catch {}
    // Throw a ReasonedRejection that callers can handle without advancing state beyond QUEUED.
    throw new ReasonedRejection(reason('SUBMIT_NOT_ATTEMPTED'))
  }

  // Private build: perform actual submission
  try {
    console.log(`[submitPath] Starting submission for intent ${intent.intent_id}`)

    let signedTx: string
    let mockBundleHash: string | undefined

    // On Sepolia, construct a minimal valid legacy tx and sign it with PUBLIC_SUBMIT_PRIVATE_KEY
    


/* COMMENTED OUT TEST SUCCESSFUL TX */
/* COMMENTED OUT TEST SUCCESSFUL TX */
/* COMMENTED OUT TEST SUCCESSFUL TX */
/* COMMENTED OUT TEST SUCCESSFUL TX */



    
    // COMMENTED OUT: Self-test transaction (0 ETH to self) - successful on Sepolia: https://sepolia.etherscan.io/tx/0xc9753a68ed7b03e4fd5edb095bb16d95cf7e2ca0260ab25189ede0b9688bf70b
    /*
    if (ENV.SEPOLIA_SWITCH) {
      if (!ENV.PUBLIC_SUBMIT_PRIVATE_KEY) {
        throw new ReasonedRejection(
          reason('SUBMIT_NOT_ATTEMPTED', {
            message: 'missing PUBLIC_SUBMIT_PRIVATE_KEY[_SEPOLIA] for Sepolia public mempool submission'
          })
        )
      }
      const provider = new JsonRpcProvider(ENV.RPC_URL || 'https://ethereum-sepolia.public.blastapi.io')
      const wallet = new Wallet(ENV.PUBLIC_SUBMIT_PRIVATE_KEY).connect(provider)
      const to = await wallet.getAddress()
      const nonce = await provider.getTransactionCount(to, 'latest')
      const fee = await provider.getFeeData()
      const gasPrice = fee.gasPrice ?? 1_500_000_000n // 1.5 gwei fallback
      const legacyTx = {
        to,
        value: 0n,
        nonce,
        gasPrice,
        gasLimit: 21000n,
        chainId: ENV.CHAIN_ID
      } as const
      signedTx = await wallet.signTransaction(legacyTx)
    } else {
    */

/* COMMENTED OUT TEST SUCCESSFUL TX */
/* COMMENTED OUT TEST SUCCESSFUL TX */
/* COMMENTED OUT TEST SUCCESSFUL TX */
/* COMMENTED OUT TEST SUCCESSFUL TX */







      // Non-Sepolia: expect an upstream signed bundle/tx. Until wired, avoid random invalid bytes.
      // Generate a placeholder and log a warning; this will likely be rejected by relays.
      console.warn('[submitPath] Warning: no real signed transaction provided for mainnet path; using placeholder bytes (will fail)')
      signedTx = `0x${crypto.randomBytes(100).toString('hex')}`
      mockBundleHash = `0x${crypto.randomBytes(32).toString('hex')}`
    // }    // Get the BundleSubmitter and submit
    const submitter = BundleSubmitter.getInstance()
    const result = await submitter.submitToRelays(signedTx, undefined, intent.intent_id)

    // Log successful submission with bundle hash for ReceiptChecker tracking
    console.log(`[submitPath] Submission completed for intent ${intent.intent_id}, bundle hash: ${result.bundleHash || mockBundleHash}`)

    // Audit log
    try {
      const dir = path.resolve(__dirname, '..', 'logs')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'submissions.jsonl')
      const rec = {
        ts: new Date().toISOString(),
        corr_id,
        intent_id: intent.intent_id,
        bundle_hash: result.bundleHash || mockBundleHash,
        status: 'submitted'
      }
      fs.appendFileSync(file, JSON.stringify(rec) + '\n')
    } catch (e) {
      console.warn('[submitPath] Failed to write submission audit log', e)
    }

  } catch (error) {
    console.error(`[submitPath] Submission failed for intent ${intent.intent_id}:`, error)
    throw error
  }
}

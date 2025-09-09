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
import { Wallet, JsonRpcProvider, ethers } from 'ethers'
import { ENV } from '../config'
import { buildAndSignEip1559Tx, requiredCostWei } from '../services/TxBuilder'
import NonceManager from '../services/NonceManager'
import BumpPolicy from '../services/BumpPolicy'

export type SubmitCtx = {
  edge: EdgeModules
  intent: { intent_id: string }
  corr_id: string
  request_hash: string
}

// Startup guard: log testnet vs mainnet behavior
try {
  if (ENV.SEPOLIA_SWITCH) {
    console.log('[submitPath] Startup: SEPOLIA_SWITCH=1; will build and submit testnet transactions to public mempool')
  } else {
    console.log('[submitPath] Startup: Mainnet mode; requires upstream signed transactions for submission')
  }
} catch {}

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

    // For testnets (Sepolia), build and submit a transaction to public mempool
    if (ENV.SEPOLIA_SWITCH) {
      if (!ENV.PUBLIC_SUBMIT_PRIVATE_KEY) {
        throw new ReasonedRejection(
          reason('SUBMIT_NOT_ATTEMPTED', {
            message: 'missing PUBLIC_SUBMIT_PRIVATE_KEY for testnet submission'
          })
        )
      }

      console.log('[submitPath] Testnet detected; building transaction for public mempool submission')

      const provider = new JsonRpcProvider(ENV.RPC_URL)
      const wallet = new Wallet(ENV.PUBLIC_SUBMIT_PRIVATE_KEY).connect(provider)
      const from = await wallet.getAddress()

      // Reserve nonce for this submission
      const nonceManager = NonceManager.getInstance(provider)
      const nonce = await nonceManager.reserveNonce(from, provider)

      // Get current fees
      const { maxFeePerGas, maxPriorityFeePerGas } = await BumpPolicy.getInitialFees(provider, 1)

      // For testnet self-transfer, simulate native ETH consumption for testing
      const isNativeIn = true; // Set to true to test native ETH spending guard
      const amountInWei = 10000000000000000n; // 0.01 ETH for low test trade size
      const txValue = isNativeIn ? amountInWei : 0n;

      // Build a simple self-transfer transaction for testing
      const signedTx = await buildAndSignEip1559Tx(wallet, {
        chainId: BigInt(ENV.CHAIN_ID),
        from,
        to: from, // Self-transfer
        nonce,
        gasLimit: 21000n,
        maxFeePerGas,
        maxPriorityFeePerGas,
        value: txValue,
        data: '0x'
      })

      // Parse the signed transaction for logging and funds check
      const parsedTx = ethers.Transaction.from(signedTx)

      // Check funds after building transaction
      const balance = await provider.getBalance(from)
      const required = requiredCostWei(BigInt(parsedTx.gasLimit), BigInt(parsedTx.maxFeePerGas || 0n), BigInt(parsedTx.value || 0n))
      if (balance < required) {
        const balanceEth = parseFloat(ethers.formatEther(balance)).toFixed(6)
        const requiredEth = parseFloat(ethers.formatEther(required)).toFixed(6)
        throw new ReasonedRejection(reason('INTERNAL_ERROR', {
          message: `Insufficient funds: balance=${balanceEth} ETH (${balance} wei), required=${requiredEth} ETH (${required} wei)`
        }))
      }

      console.log(`[submitPath] Funds check passed: balance=${ethers.formatEther(balance)} ETH, required=${ethers.formatEther(required)} ETH`)

      // Pre-send log dump for debugging
      console.log('[submitPath] Pre-send transaction details:', {
        derivedAmountInWei: parsedTx.value?.toString() || '0',
        txValue: parsedTx.value?.toString() || '0',
        gasLimit: parsedTx.gasLimit.toString(),
        maxFeePerGas: parsedTx.maxFeePerGas?.toString() || '0',
        maxPriorityFeePerGas: parsedTx.maxPriorityFeePerGas?.toString() || '0',
        from: parsedTx.from,
        to: parsedTx.to,
        dataLength: parsedTx.data.length,
        nonce: parsedTx.nonce.toString(),
        chainId: parsedTx.chainId?.toString() || ENV.CHAIN_ID.toString(),
        balanceWei: balance.toString(),
        requiredWei: required.toString()
      })

      console.log(`[submitPath] Built testnet transaction: nonce=${nonce}, from=${from}`)

      // Submit via BundleSubmitter (will route to public mempool)
      const submitter = BundleSubmitter.getInstance()
      const result = await submitter.submitToRelays(signedTx, undefined, intent.intent_id)

      // Log successful submission
      console.log(`[submitPath] Testnet submission completed for intent ${intent.intent_id}, bundle hash: ${result.bundleHash || 'none'}`)

      // Audit log
      try {
        const dir = path.resolve(__dirname, '..', 'logs')
        fs.mkdirSync(dir, { recursive: true })
        const file = path.join(dir, 'submissions.jsonl')
        const rec = {
          ts: new Date().toISOString(),
          corr_id,
          intent_id: intent.intent_id,
          bundle_hash: result.bundleHash,
          status: 'submitted_testnet',
          network: 'testnet'
        }
        fs.appendFileSync(file, JSON.stringify(rec) + '\n')
      } catch (e) {
        console.warn('[submitPath] Failed to write submission audit log', e)
      }

      return // Success - no need to continue
    }

    // For mainnet, require upstream signed transaction (no placeholder bytes)
    console.warn('[submitPath] Mainnet detected; no upstream signed transaction provided - skipping submission.')
    throw new ReasonedRejection(reason('SUBMIT_NOT_ATTEMPTED', { message: 'no upstream signed tx provided for mainnet' }))

  } catch (error) {
    console.error(`[submitPath] Submission failed for intent ${intent.intent_id}:`, error)
    throw error
  }
}

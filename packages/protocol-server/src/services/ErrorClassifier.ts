import * as ethers from 'ethers'
import { Wallet, JsonRpcProvider, Transaction } from 'ethers'
import { ENV } from '../config'
import NonceManager from './NonceManager'
import BumpPolicy from './BumpPolicy'

/**
 * Error Classification and Handling for Ethereum Transaction Submissions
 */
export enum ErrorAction {
  ACCEPT_SUCCESS = 'accept_success', // already known → treat as success
  BUMP_FEE_RETRY = 'bump_and_retry', // replacement underpriced → bump and retry same nonce
  REFRESH_NONCE_RESCHEDULE = 'refresh_nonce_reschedule', // nonce too low → refresh
  HARD_FAIL = 'hard_fail_insufficient_funds', // insufficient funds → hard fail
  HARD_FAIL_PROVIDER_BALANCE_FETCH = 'hard_fail_provider_balance_fetch', // provider balance fetch fail
  BACKOFF_RETRY = 'backoff_retry', // limited retry on misc
  FALLBACK_TO_TYPE2_LEGACY = 'fallback_to_type2_legacy' // RPC says type not supported
}

export interface ErrorClassification {
  action: ErrorAction
  reason: string
  retryable: boolean
  maxRetries: number
  backoffMs?: number
}

export class ErrorClassifier {
  /**
   * Classify an error and determine the appropriate action
   */
  static classifyError(error: any): ErrorClassification {
    let originalMessage = error?.error?.message
      || error?.error?.data?.message
      || (() => { try { const b = error?.body; if (!b) return undefined; const j = JSON.parse(b); return j?.error?.message || j?.message } catch { return undefined } })()
      || error?.message
      || ''
    const msg = originalMessage.toLowerCase()
    const code = error?.error?.code || error?.code
    console.error('[ErrorClassifier] RPC error:', { code, message: originalMessage })

    // Already known - transaction is already in mempool
  if (/already known/i.test(msg)) {
      return {
        action: ErrorAction.ACCEPT_SUCCESS,
        reason: 'Transaction already known to network',
        retryable: false,
        maxRetries: 0
      }
    }

    // Replacement underpriced - need higher fees for same nonce
  if (/replacement transaction underpriced|transaction underpriced/i.test(msg)) {
      return {
        action: ErrorAction.BUMP_FEE_RETRY,
    reason: 'Transaction fees too low for replacement',
        retryable: true,
        maxRetries: 3
      }
    }

    // Nonce too low - our nonce is behind the network
  if (/nonce too low/i.test(msg) || (code === -32000 && /nonce/i.test(msg))) {
      return {
        action: ErrorAction.REFRESH_NONCE_RESCHEDULE,
        reason: 'Nonce is too low, needs refresh',
        retryable: true,
        maxRetries: 2
      }
    }

    // Insufficient funds - wallet doesn't have enough ETH
  if (/insufficient funds|not enough funds/i.test(msg)) {
      return {
    action: ErrorAction.HARD_FAIL,
        reason: 'Insufficient funds in wallet',
        retryable: false,
        maxRetries: 0
      }
    }

    // Transaction type not supported - fallback to new transaction
  if (/transaction type not supported|rlp: expected input list|invalid-raw-tx/i.test(msg)) {
      return {
    action: ErrorAction.FALLBACK_TO_TYPE2_LEGACY,
    reason: 'Transaction type not supported by RPC',
        retryable: true,
    maxRetries: 1,
    backoffMs: 0
      }
    }

    // Network congestion or temporary issues
    if (msg.includes('timeout') || msg.includes('network') || code === -32005) {
      return {
        action: ErrorAction.BACKOFF_RETRY,
        reason: 'Network or timeout issue',
        retryable: true,
        maxRetries: 3,
        backoffMs: 2000
      }
    }

    // Generic -32000 only if no message: do single short backoff
    if (code === -32000 && !originalMessage) {
      return {
        action: ErrorAction.BACKOFF_RETRY,
        reason: 'RPC -32000 without message',
        retryable: true,
        maxRetries: 1,
        backoffMs: 500
      }
    }

    // Default case - unknown error
    return {
      action: ErrorAction.BACKOFF_RETRY,
      reason: 'Unknown transaction error',
      retryable: true,
      maxRetries: 1,
      backoffMs: 5000
    }
  }

  /**
   * Execute the appropriate action for a classified error
   */
  static async executeAction(
    classification: ErrorClassification,
    signedTransaction: string,
    provider: JsonRpcProvider,
    retryCount: number,
    walletAddress?: string
  ): Promise<{ txHash?: string; shouldRetry: boolean; newSignedTx?: string }> {
    switch (classification.action) {
      case ErrorAction.ACCEPT_SUCCESS:
        return await this.handleAcceptSuccess(signedTransaction)

      case ErrorAction.BUMP_FEE_RETRY:
        return await this.handleBumpFeeRetry(signedTransaction, provider, retryCount)

      case ErrorAction.REFRESH_NONCE_RESCHEDULE:
        return await this.handleRefreshNonce(walletAddress || '', provider, signedTransaction)

      case ErrorAction.HARD_FAIL:
      case ErrorAction.HARD_FAIL_PROVIDER_BALANCE_FETCH:
        // Don't fetch balance here; reason should already include details
        throw new Error(`HARD FAIL: ${classification.reason}`)

      case ErrorAction.BACKOFF_RETRY:
        if (retryCount < classification.maxRetries) {
          // Special handling for transaction type issues - create fallback transaction
          // No-op here; FALLBACK_TO_TYPE2_LEGACY handles type fallback explicitly

          console.log(`⏳ [ErrorClassifier] Backing off for ${classification.backoffMs}ms before retry ${retryCount + 1}/${classification.maxRetries}`)
          await this.delay(classification.backoffMs || 1000)
          return { shouldRetry: true }
        } else {
          throw new Error(`MAX RETRIES EXCEEDED: ${classification.reason}`)
        }

      case ErrorAction.FALLBACK_TO_TYPE2_LEGACY:
        return await this.handleFallbackTransaction(walletAddress || '', provider, signedTransaction)

      default:
        throw new Error(`UNKNOWN ACTION: ${classification.action}`)
    }
  }

  private static async handleAcceptSuccess(signedTransaction: string): Promise<{ txHash: string; shouldRetry: boolean }> {
    console.log('✅ [ErrorClassifier] Treating error as success')
    try {
      const parsedTx = Transaction.from(signedTransaction)
      if (parsedTx.hash) {
  console.log(`✅ [ErrorClassifier] accepted-known → tracking ${parsedTx.hash}`)
        return { txHash: parsedTx.hash, shouldRetry: false }
      } else {
        throw new Error('Could not extract transaction hash')
      }
    } catch (parseError) {
      throw new Error(`Could not parse transaction: ${parseError}`)
    }
  }

  private static async handleBumpFeeRetry(
    signedTransaction: string,
    provider: JsonRpcProvider,
    retryCount: number
  ): Promise<{ shouldRetry: boolean; newSignedTx: string }> {
    if (!ENV.PUBLIC_SUBMIT_PRIVATE_KEY) {
      throw new Error('Cannot bump fees: no PUBLIC_SUBMIT_PRIVATE_KEY available')
    }

    console.log(`💰 [ErrorClassifier] Bumping fees for retry ${retryCount + 1}`)

    const wallet = new Wallet(ENV.PUBLIC_SUBMIT_PRIVATE_KEY).connect(provider)
    const from = await wallet.getAddress()

    // Reuse the same nonce and original call details
    const parsedTx = Transaction.from(signedTransaction)
    const nonce = BigInt(parsedTx.nonce)
    const gasLimit = BigInt(parsedTx.gasLimit)
    const to = parsedTx.to || from
    const value = BigInt(parsedTx.value || 0)
    const data = parsedTx.data

    const currentFees = await BumpPolicy.getInitialFees(provider, 1)
    const { bumpFees } = await import('./TxBuilder')
    const bumped = bumpFees(currentFees.maxFeePerGas, currentFees.maxPriorityFeePerGas)

    const { buildAndSignEip1559Tx } = await import('./TxBuilder')
    const newSignedTx = await buildAndSignEip1559Tx(wallet, {
      chainId: BigInt(ENV.CHAIN_ID),
      from,
      to,
      nonce,
      gasLimit,
      maxFeePerGas: bumped.maxFee,
      maxPriorityFeePerGas: bumped.maxPrio,
      value,
      data
    })
    return { shouldRetry: true, newSignedTx }
  }

  private static async handleRefreshNonce(
    walletAddress: string,
    provider: JsonRpcProvider,
    signedTransaction: string
  ): Promise<{ shouldRetry: boolean; newSignedTx: string }> {
    if (!ENV.PUBLIC_SUBMIT_PRIVATE_KEY) {
      throw new Error('Cannot refresh nonce: no PUBLIC_SUBMIT_PRIVATE_KEY available')
    }

    console.log('🔄 [ErrorClassifier] Refreshing nonce and rescheduling transaction')

  const wallet = new Wallet(ENV.PUBLIC_SUBMIT_PRIVATE_KEY).connect(provider)
  const nonceManager = NonceManager.getInstance(provider)
  // Refresh from chain cache to keep state up to date, but do NOT reserve a new nonce here
  await nonceManager.refreshFromChain(walletAddress)

  // Parse original transaction and reuse the same lease nonce
    const parsedTx = Transaction.from(signedTransaction)
  const nonce = BigInt(parsedTx.nonce)
    const currentFees = await BumpPolicy.getInitialFees(provider, 1)

    const { buildAndSignEip1559Tx } = await import('./TxBuilder')
    const newSignedTx = await buildAndSignEip1559Tx(wallet, {
      chainId: BigInt(ENV.CHAIN_ID),
      from: walletAddress,
      to: parsedTx.to || walletAddress,
      nonce,
      gasLimit: BigInt(parsedTx.gasLimit),
      maxFeePerGas: currentFees.maxFeePerGas,
      maxPriorityFeePerGas: currentFees.maxPriorityFeePerGas,
      value: BigInt(parsedTx.value || 0),
      data: parsedTx.data
    })
    return { shouldRetry: true, newSignedTx }
  }

  private static async handleFallbackTransaction(
    walletAddress: string,
    provider: JsonRpcProvider,
    signedTransaction?: string
  ): Promise<{ shouldRetry: boolean; newSignedTx: string }> {
    if (!ENV.PUBLIC_SUBMIT_PRIVATE_KEY) {
      throw new Error('Cannot create fallback transaction: no PUBLIC_SUBMIT_PRIVATE_KEY available')
    }

    console.log('🔄 [ErrorClassifier] Creating fallback transaction for unsupported type')

    const wallet = new Wallet(ENV.PUBLIC_SUBMIT_PRIVATE_KEY).connect(provider)
    const nonceManager = NonceManager.getInstance(provider)
    let leaseNonce: bigint | undefined
    // If we can parse the original signed tx, reuse its nonce; avoid taking a new lease
    if (signedTransaction) {
      try { const parsed = Transaction.from(signedTransaction); leaseNonce = BigInt(parsed.nonce) } catch {}
    }
    const nonce = leaseNonce !== undefined ? leaseNonce : await nonceManager.reserveNonce(walletAddress, provider)
    const { maxFeePerGas, maxPriorityFeePerGas } = await BumpPolicy.getInitialFees(provider, 1)

    // Prefer type-2; only legacy attempted elsewhere if strictly required
    const { buildAndSignEip1559Tx } = await import('./TxBuilder')
    const newSignedTx = await buildAndSignEip1559Tx(wallet, {
      chainId: BigInt(ENV.CHAIN_ID),
      from: walletAddress,
      to: walletAddress,
  nonce: BigInt(nonce),
      gasLimit: 21000n,
      maxFeePerGas,
      maxPriorityFeePerGas,
      value: 0n,
      data: '0x'
    })

    return { shouldRetry: true, newSignedTx }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export default ErrorClassifier

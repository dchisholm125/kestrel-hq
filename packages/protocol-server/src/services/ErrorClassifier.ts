import * as ethers from 'ethers'
import { Wallet, JsonRpcProvider, Transaction } from 'ethers'
import { ENV } from '../config'
import NonceManager from './NonceManager'
import BumpPolicy from './BumpPolicy'

/**
 * Error Classification and Handling for Ethereum Transaction Submissions
 */
export enum ErrorAction {
  ACCEPT_SUCCESS = 'accept_success',           // Treat as success (e.g., already known)
  BUMP_FEE_RETRY = 'bump_fee_retry',           // Bump fees and retry same nonce
  REFRESH_NONCE_RESCHEDULE = 'refresh_nonce_reschedule', // Refresh nonce and retry
  HARD_FAIL = 'hard_fail',                     // Fail immediately with clear message
  BACKOFF_RETRY = 'backoff_retry'              // Backoff and retry with limit
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
    const msg = (error?.error?.message || error?.message || '').toLowerCase()
    const code = error?.error?.code || error?.code

    // Already known - transaction is already in mempool
    if (msg.includes('already known')) {
      return {
        action: ErrorAction.ACCEPT_SUCCESS,
        reason: 'Transaction already known to network',
        retryable: false,
        maxRetries: 0
      }
    }

    // Replacement underpriced - need higher fees for same nonce
    if (msg.includes('replacement transaction underpriced') || msg.includes('transaction underpriced')) {
      return {
        action: ErrorAction.BUMP_FEE_RETRY,
        reason: 'Transaction fees too low for replacement',
        retryable: true,
        maxRetries: 3
      }
    }

    // Nonce too low - our nonce is behind the network
    if (msg.includes('nonce too low') || code === -32000 && msg.includes('nonce')) {
      return {
        action: ErrorAction.REFRESH_NONCE_RESCHEDULE,
        reason: 'Nonce is too low, needs refresh',
        retryable: true,
        maxRetries: 2
      }
    }

    // Insufficient funds - wallet doesn't have enough ETH
    if (msg.includes('insufficient funds') || msg.includes('not enough funds')) {
      return {
        action: ErrorAction.HARD_FAIL,
        reason: 'Insufficient funds in wallet',
        retryable: false,
        maxRetries: 0
      }
    }

    // Transaction type not supported - fallback to new transaction
    if (msg.includes('transaction type not supported') || msg.includes('rlp: expected input list') || msg.includes('invalid-raw-tx')) {
      return {
        action: ErrorAction.BACKOFF_RETRY,
        reason: 'Transaction type not supported by RPC',
        retryable: true,
        maxRetries: 1, // Only try fallback once
        backoffMs: 0 // Immediate fallback
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

    // RPC errors
    if (code && code < 0 && code >= -39999) {
      return {
        action: ErrorAction.BACKOFF_RETRY,
        reason: `RPC error ${code}`,
        retryable: true,
        maxRetries: 2,
        backoffMs: 1000
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
        // For insufficient funds, include current balance in error message
        if (classification.reason.includes('Insufficient funds')) {
          try {
            const balance = await provider.getBalance(walletAddress || '0x0000000000000000000000000000000000000000')
            const balanceEth = parseFloat(ethers.formatEther(balance)).toFixed(6)
            throw new Error(`HARD FAIL: ${classification.reason}. Current balance: ${balanceEth} ETH`)
          } catch (balanceError) {
            throw new Error(`HARD FAIL: ${classification.reason}. Could not fetch balance: ${balanceError}`)
          }
        }
        throw new Error(`HARD FAIL: ${classification.reason}`)

      case ErrorAction.BACKOFF_RETRY:
        if (retryCount < classification.maxRetries) {
          // Special handling for transaction type issues - create fallback transaction
          if (classification.reason.includes('not supported')) {
            return await this.handleFallbackTransaction(walletAddress || '', provider)
          }

          console.log(`⏳ [ErrorClassifier] Backing off for ${classification.backoffMs}ms before retry ${retryCount + 1}/${classification.maxRetries}`)
          await this.delay(classification.backoffMs || 1000)
          return { shouldRetry: true }
        } else {
          throw new Error(`MAX RETRIES EXCEEDED: ${classification.reason}`)
        }

      default:
        throw new Error(`UNKNOWN ACTION: ${classification.action}`)
    }
  }

  private static async handleAcceptSuccess(signedTransaction: string): Promise<{ txHash: string; shouldRetry: boolean }> {
    console.log('✅ [ErrorClassifier] Treating error as success')
    try {
      const parsedTx = Transaction.from(signedTransaction)
      if (parsedTx.hash) {
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
    const to = await wallet.getAddress()
    const nonceManager = NonceManager.getInstance(provider)

    // For fee bumps, we want to reuse the same nonce (assuming it's pending)
    // But we need to get the current nonce from the transaction
    let nonce: number
    try {
      const parsedTx = Transaction.from(signedTransaction)
      nonce = Number(parsedTx.nonce)
    } catch {
      // Fallback to getting next nonce if parsing fails
      nonce = await nonceManager.getNextNonce(to, provider)
    }

    const currentFees = await BumpPolicy.getInitialFees(provider, 1)
    const bumpedFees = BumpPolicy.bumpFees(currentFees.maxFeePerGas, currentFees.maxPriorityFeePerGas, retryCount)

    if (!bumpedFees) {
      throw new Error('Maximum fee bumps reached')
    }

    const replacementTx = {
      to,
      value: 0n,
      nonce,
      maxFeePerGas: bumpedFees.maxFeePerGas,
      maxPriorityFeePerGas: bumpedFees.maxPriorityFeePerGas,
      gasLimit: 21000n,
      chainId: ENV.CHAIN_ID,
      type: 2
    } as const

    const newSignedTx = await wallet.signTransaction(replacementTx)
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

    // Force refresh the nonce by clearing cache for this address
    const freshNonce = await provider.getTransactionCount(walletAddress, 'pending')
    ;(nonceManager as any).nextNonce.set(walletAddress.toLowerCase(), freshNonce)

    // Get the next nonce (which should now be fresh)
    const nonce = await nonceManager.getNextNonce(walletAddress, provider)

    // Parse original transaction to get other details
    const parsedTx = Transaction.from(signedTransaction)
    const currentFees = await BumpPolicy.getInitialFees(provider, 1)

    const refreshedTx = {
      to: parsedTx.to,
      value: parsedTx.value,
      nonce,
      maxFeePerGas: currentFees.maxFeePerGas,
      maxPriorityFeePerGas: currentFees.maxPriorityFeePerGas,
      gasLimit: parsedTx.gasLimit,
      chainId: ENV.CHAIN_ID,
      type: 2,
      data: parsedTx.data
    } as const

    const newSignedTx = await wallet.signTransaction(refreshedTx)
    return { shouldRetry: true, newSignedTx }
  }

  private static async handleFallbackTransaction(
    walletAddress: string,
    provider: JsonRpcProvider
  ): Promise<{ shouldRetry: boolean; newSignedTx: string }> {
    if (!ENV.PUBLIC_SUBMIT_PRIVATE_KEY) {
      throw new Error('Cannot create fallback transaction: no PUBLIC_SUBMIT_PRIVATE_KEY available')
    }

    console.log('🔄 [ErrorClassifier] Creating fallback transaction for unsupported type')

    const wallet = new Wallet(ENV.PUBLIC_SUBMIT_PRIVATE_KEY).connect(provider)
    const nonceManager = NonceManager.getInstance(provider)
    const nonce = await nonceManager.getNextNonce(walletAddress, provider)
    const { maxFeePerGas, maxPriorityFeePerGas } = await BumpPolicy.getInitialFees(provider, 1)

    const fallbackTx = {
      to: walletAddress, // Send to self
      value: 0n,
      nonce,
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit: 21000n,
      chainId: ENV.CHAIN_ID,
      type: 2
    } as const

    const newSignedTx = await wallet.signTransaction(fallbackTx)
    return { shouldRetry: true, newSignedTx }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export default ErrorClassifier

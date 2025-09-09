import { Wallet, parseEther } from 'ethers'
import { JsonRpcProvider } from 'ethers'

/**
 * Public Transaction Submitter
 * For testnets like Sepolia where private bundles aren't well supported by relays.
 * Sends transactions to the public mempool instead of private relays.
 */

export interface PublicSubmissionOptions {
  to?: string
  value?: string
  gasLimit?: number
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
}

export interface PublicSubmissionResult {
  hash: string
  nonce: number
  chainId: number
  blockNumber?: number
  status?: number
  gasUsed?: string
}

export class PublicSubmitter {
  private provider: JsonRpcProvider
  private wallet: Wallet

  constructor(provider: JsonRpcProvider, wallet: Wallet) {
    this.provider = provider
    this.wallet = wallet
  }

  /**
   * Submit a transaction to the public mempool
   */
  async submitPublicTx(options: PublicSubmissionOptions = {}): Promise<PublicSubmissionResult> {
    console.log('🌐 [PublicSubmitter] Preparing public transaction submission...')

    try {
      // Default to self-send smoke test if no recipient specified
      const to = options.to || await this.wallet.getAddress()
      const value = options.value ? parseEther(options.value) : parseEther('0.0001')

      console.log('🌐 [PublicSubmitter] Transaction details:', {
        to,
        value: value.toString(),
        chainId: (await this.provider.getNetwork()).chainId,
        mode: 'PUBLIC_MEMPOOL'
      })

      // Prepare transaction
      const txRequest = {
        to,
        value,
        gasLimit: options.gasLimit,
        maxFeePerGas: options.maxFeePerGas ? parseEther(options.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: options.maxPriorityFeePerGas ? parseEther(options.maxPriorityFeePerGas) : undefined
      }

      console.log('📤 [PublicSubmitter] Sending transaction to public mempool...')

      // Send transaction
      const tx = await this.wallet.sendTransaction(txRequest)

      console.log(`✅ [PublicSubmitter] Transaction sent!`, {
        hash: tx.hash,
        nonce: tx.nonce,
        chainId: (await this.provider.getNetwork()).chainId,
        mode: 'PUBLIC_MEMPOOL'
      })

      // Wait for confirmation
      console.log('⏳ [PublicSubmitter] Waiting for confirmation...')
      const receipt = await tx.wait()

      if (!receipt) {
        throw new Error('Transaction receipt is null')
      }

      console.log(`🎉 [PublicSubmitter] Transaction confirmed!`, {
        hash: tx.hash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        gasUsed: receipt.gasUsed?.toString(),
        mode: 'PUBLIC_MEMPOOL'
      })

      return {
        hash: tx.hash,
        nonce: tx.nonce,
        chainId: Number((await this.provider.getNetwork()).chainId),
        blockNumber: receipt.blockNumber,
        status: receipt.status ?? undefined,
        gasUsed: receipt.gasUsed?.toString()
      }

    } catch (error) {
      console.error('❌ [PublicSubmitter] Transaction failed:', error)
      throw error
    }
  }

  /**
   * Get current gas prices for optimization
   */
  async getGasPrices() {
    try {
      const feeData = await this.provider.getFeeData()
      return {
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        gasPrice: feeData.gasPrice
      }
    } catch (error) {
      console.warn('⚠️ [PublicSubmitter] Could not fetch gas prices:', error)
      return null
    }
  }
}

export default PublicSubmitter

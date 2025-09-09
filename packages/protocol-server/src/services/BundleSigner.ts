import * as ethers from 'ethers'
import { GreedyBundleResult, BundleCandidate } from './BatchingEngine'
import NonceManager from './NonceManager'
import BumpPolicy from './BumpPolicy'

export interface Bundle {
  trades: BundleCandidate[]
  totalGas: bigint
  totalNetProfitWei: bigint
}

export interface Call {
  target: string
  value: string | number | bigint
  data: string
}

/**
 * BundleSigner - Creates and signs transactions that call the BatchExecutor contract
 * to execute bundles of trades atomically.
 */
export class BundleSigner {
  private wallet: ethers.Wallet
  private batchExecutorAddress: string
  private provider?: ethers.Provider

  constructor(privateKey: string, batchExecutorAddress: string, provider?: ethers.Provider) {
    this.wallet = new ethers.Wallet(privateKey, provider)
    this.batchExecutorAddress = batchExecutorAddress
    this.provider = provider
  }

  /**
   * Takes a bundle and creates a signed transaction that calls executeBatch on the BatchExecutor contract
   */
  async signBundle(bundle: Bundle | GreedyBundleResult): Promise<string> {
    // Convert trades to Call structs for the BatchExecutor
    const calls = this.bundleToCalls(bundle.trades)
    console.log(`[BundleSigner] Created ${calls.length} calls from ${bundle.trades.length} trades`)
    
    // Create the contract interface
    const batchExecutorAbi = [
      'function executeBatch((address target, uint256 value, bytes data)[] calls) external payable returns (bytes[] memory results)'
    ]
    const iface = new ethers.Interface(batchExecutorAbi)
    
    // Encode the function call
    const data = iface.encodeFunctionData('executeBatch', [calls])
    console.log(`[BundleSigner] Encoded function data length: ${data.length}`)
    
    // Get chain ID from provider if available
    let chainId = 1 // Default to mainnet
    if (this.provider) {
      try {
        const network = await this.provider.getNetwork()
        chainId = Number(network.chainId)
      } catch (error) {
        console.warn('[BundleSigner] chain ID fetch failed, using default:', error)
      }
    }
    
    // Estimate gas if provider is available
    let gasLimit = 500000n // Default fallback
    if (this.provider) {
      try {
        console.log(`[BundleSigner] Estimating gas for BatchExecutor call...`)
        const estimated = await this.provider.estimateGas({
          to: this.batchExecutorAddress,
          data,
          from: this.wallet.address
        })
        gasLimit = estimated + (estimated / 10n) // Add 10% buffer
        console.log(`[BundleSigner] Gas estimation successful: ${gasLimit}`)
      } catch (error) {
        console.warn('[BundleSigner] gas estimation failed, using fallback:', error)
      }
    }

  // Managed nonce via NonceManager
  const nonceManager = NonceManager.getInstance(this.provider)
  const nonce = await nonceManager.getNextNonce(this.wallet.address, this.provider)
  console.log(`[BundleSigner] Using managed nonce ${nonce} for ${this.wallet.address}`)

    // Get EIP-1559 fees using BumpPolicy
    const { maxFeePerGas, maxPriorityFeePerGas } = await BumpPolicy.getInitialFees(this.provider, 1) // 1 gwei priority on Sepolia
    console.log(`[BundleSigner] Using EIP-1559 fees: maxFee=${maxFeePerGas}, maxPriority=${maxPriorityFeePerGas}`)

    // Create the transaction (Type-2)
    const tx = {
      to: this.batchExecutorAddress,
      data,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce,
      value: 0, // No ETH being sent directly
      type: 2, // EIP-1559 Type-2 transaction
      chainId
    }

    // Sign the transaction
    const signedTx = await this.wallet.signTransaction(tx)
    return signedTx
  }

  /**
   * Converts bundle trades to BatchExecutor Call structs
   */
  private bundleToCalls(trades: BundleCandidate[]): Call[] {
    return trades.map(trade => {
      // Parse the raw transaction to extract call details
      const parsedTx = ethers.Transaction.from(trade.rawTransaction)
      
      return {
        target: parsedTx.to || ethers.ZeroAddress,
        value: parsedTx.value || 0,
        data: parsedTx.data || '0x'
      }
    })
  }

  /**
   * Get the signer's address
   */
  get address(): string {
    return this.wallet.address
  }
}

#!/usr/bin/env node

/**
 * Self-Proof Script for Public Transaction Pipeline
 * Tests the complete flow: intent → queue → submit path → publicSubmit
 */

import { Wallet, parseEther } from 'ethers'
import { ENV } from '../config'
import BundleSubmitter from '../services/BundleSubmitter'
import ReceiptChecker from '../services/ReceiptChecker'

async function runSelfProofTest() {
  console.log('🧪 [SelfProof] Starting public transaction pipeline test...')
  console.log('🧪 [SelfProof] Configuration:', {
    network: ENV.SEPOLIA_SWITCH ? 'Sepolia' : 'Mainnet',
    submissionMode: ENV.SUBMISSION_MODE,
    mockMode: ENV.SUBMIT_MOCK,
    chainId: ENV.CHAIN_ID,
    rpcUrl: ENV.RPC_URL
  })

  try {
    // 1. Create wallet from environment
    if (!ENV.FLASHBOTS_SIGNING_KEY) {
      throw new Error('FLASHBOTS_SIGNING_KEY not found in environment')
    }

    const wallet = new Wallet(ENV.FLASHBOTS_SIGNING_KEY)
    console.log('🧪 [SelfProof] Wallet initialized:', {
      address: wallet.address,
      hasPrivateKey: !!ENV.FLASHBOTS_SIGNING_KEY
    })

    // 2. Check wallet balance
    const provider = new (await import('ethers')).JsonRpcProvider(ENV.RPC_URL)
    const connectedWallet = wallet.connect(provider)
    const balance = await provider.getBalance(wallet.address)
    console.log('🧪 [SelfProof] Wallet balance:', {
      address: wallet.address,
      balance: balance.toString(),
      balanceEth: parseFloat(balance.toString()) / 1e18
    })

    if (balance < parseEther('0.001')) {
      throw new Error('Insufficient balance for test transaction')
    }

    // 3. Create a tiny self-send transaction
    const txRequest = {
      to: wallet.address, // Self-send
      value: parseEther('0.0001'), // Tiny amount
      gasLimit: 21000 // Standard transfer gas limit
    }

    console.log('🧪 [SelfProof] Transaction details:', {
      to: txRequest.to,
      value: txRequest.value.toString(),
      valueEth: '0.0001',
      gasLimit: txRequest.gasLimit
    })

    // 4. Get gas prices for logging
    const feeData = await provider.getFeeData()
    console.log('🧪 [SelfProof] Current gas prices:', {
      maxFeePerGas: feeData.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
      gasPrice: feeData.gasPrice?.toString()
    })

    // 5. Sign the transaction
    const signedTx = await connectedWallet.signTransaction(txRequest)
    console.log('🧪 [SelfProof] Transaction signed:', {
      signedTxLength: signedTx.length,
      signedTxPrefix: signedTx.substring(0, 20) + '...'
    })

    // 6. Generate intent ID for tracking
    const intentId = `self-proof-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    console.log('🧪 [SelfProof] Generated intent ID:', intentId)

    // 7. Submit through BundleSubmitter (should route to publicSubmit)
    const startTime = Date.now()
    console.log('🧪 [SelfProof] Submitting through BundleSubmitter pipeline...')

    const bundleSubmitter = BundleSubmitter.getInstance()
    const result = await bundleSubmitter.submitToRelays(signedTx, undefined, intentId)

    const submitTime = Date.now() - startTime
    console.log('🧪 [SelfProof] Submission result:', {
      bundleHash: result.bundleHash,
      submitTimeMs: submitTime,
      intentId: intentId
    })

    if (!result.bundleHash) {
      throw new Error('No transaction hash returned from submission')
    }

    // 8. Wait for confirmation and log details
    console.log('🧪 [SelfProof] Waiting for transaction confirmation...')

    const receipt = await provider.waitForTransaction(result.bundleHash)
    const confirmTime = Date.now() - startTime

    if (!receipt) {
      throw new Error('Transaction receipt is null')
    }

    console.log('🎉 [SelfProof] Transaction confirmed!', {
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toString(),
      effectiveGasPrice: receipt.gasPrice?.toString(),
      totalElapsedMs: confirmTime,
      submitToConfirmMs: confirmTime - submitTime,
      status: receipt.status ? 'SUCCESS' : 'FAILED'
    })

    // 9. Verify receipt tracking
    const receiptChecker = new ReceiptChecker()
    const status = receiptChecker.getStatus()
    console.log('🧪 [SelfProof] Receipt tracking status:', {
      totalTracked: status.total,
      pending: status.pending,
      included: status.included,
      failed: status.failed,
      ourIntentId: intentId,
      ourTxHash: result.bundleHash
    })

    console.log('✅ [SelfProof] Self-proof test completed successfully!')
    console.log('📊 [SelfProof] Summary:', {
      network: ENV.SEPOLIA_SWITCH ? 'Sepolia' : 'Mainnet',
      mode: ENV.SUBMISSION_MODE,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      totalTimeMs: confirmTime,
      gasUsed: receipt.gasUsed?.toString(),
      status: receipt.status ? 'SUCCESS' : 'FAILED'
    })

  } catch (error) {
    console.error('❌ [SelfProof] Test failed:', error)
    console.error('❌ [SelfProof] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5).join('\n') : undefined
    })
    process.exit(1)
  }
}

// Run the test
runSelfProofTest().catch((error) => {
  console.error('💥 [SelfProof] Unhandled error:', error)
  process.exit(1)
})

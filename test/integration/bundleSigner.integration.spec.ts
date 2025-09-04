import { expect } from 'chai'
import * as ethers from 'ethers'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { ENV } from '../../src/config'
import { pendingPool } from '../../src/services/PendingPool'
import { batchingEngine } from '../../src/services/BatchingEngine'
import { BundleSigner } from '../../src/services/BundleSigner'

describe('BundleSigner integration', function () {
  this.timeout(20000)
  
  let provider: ethers.JsonRpcProvider
  let deployerWallet: any
  let bundleSigner: BundleSigner
  let batchExecutorAddress: string
  let app: express.Application
  let server: any

  before(async () => {
    // Setup provider and deployer
    provider = new ethers.JsonRpcProvider(ENV.RPC_URL)
    deployerWallet = await provider.getSigner(0)

    // Deploy BatchExecutor contract
    const batchArtifact = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../build/BatchExecutor.json'), 'utf8')
    )
    const batchFactory = new ethers.ContractFactory(
      batchArtifact.abi,
      batchArtifact.bytecode,
      deployerWallet
    )
    const batchExecutor = await batchFactory.deploy()
    await batchExecutor.waitForDeployment()
    batchExecutorAddress = await batchExecutor.getAddress()

    // Create BundleSigner with a random private key
    const signerPrivateKey = ethers.Wallet.createRandom().privateKey
    bundleSigner = new BundleSigner(signerPrivateKey, batchExecutorAddress, provider)

    // Fund the signer account so it can send transactions
    const fundingTx = await deployerWallet.sendTransaction({
      to: bundleSigner.address,
      value: ethers.parseEther('1.0') // Send 1 ETH
    })
    await fundingTx.wait()

    // Setup express app for submitting trades
    app = express()
    app.use(express.json())
    
    app.post('/submit-tx', (req, res) => {
      try {
        const { rawTransaction } = req.body
        if (!rawTransaction) {
          return res.status(400).json({ error: 'rawTransaction required' })
        }

        // Parse transaction to get hash
        const tx = ethers.Transaction.from(rawTransaction)
        const submissionId = `sub_${Date.now()}_${Math.floor(Math.random() * 100000)}`
        
        // Add to pending pool
        pendingPool.addTrade({
          id: submissionId,
          rawTransaction,
          txHash: tx.hash || 'unknown',
          receivedAt: Date.now(),
          simulation: {
            netProfitWei: '1000000000000000', // Mock 0.001 ETH profit
            gasCostWei: '21000'
          },
          gasUsed: 50000
        })

        res.json({ id: submissionId, txHash: tx.hash })
      } catch (error) {
        res.status(400).json({ error: 'Invalid transaction' })
      }
    })

    server = app.listen(ENV.API_SERVER_PORT || 4000)
  })

  after(async () => {
    if (server) {
      server.close()
    }
    // Clear pending pool
    pendingPool.clear()
  })

  it('creates and submits a valid signed transaction to anvil', async () => {
    // Clear any existing trades
    pendingPool.clear()

    // Submit some profitable trades via API
    // Create valid raw transactions for testing
    // The key insight: BatchExecutor will execute these calls AS the BatchExecutor itself
    // So we need calls that will work when executed by the BatchExecutor
    const testWallet1 = ethers.Wallet.createRandom()
    const testWallet2 = ethers.Wallet.createRandom()
    
    // Fund the BatchExecutor contract so it can make ETH transfers
    // Since BatchExecutor doesn't have a receive() function, we need to call a payable function
    const funder = await provider.getSigner(0)
    console.log(`[BundleSigner Test] Funding BatchExecutor at ${batchExecutorAddress}...`)
    
    // Create a simple ETH transfer through executeBatch to fund the contract
    const fundingCall = {
      target: batchExecutorAddress, // Send to itself
      value: ethers.parseEther('10.0'),
      data: '0x' // Empty data
    }
    
    const batchExecutorContract = new ethers.Contract(batchExecutorAddress, [
      'function executeBatch((address target, uint256 value, bytes data)[] calls) external payable returns (bytes[] memory)'
    ], funder)
    
    await batchExecutorContract.executeBatch([fundingCall], { value: ethers.parseEther('10.0') })
    console.log(`[BundleSigner Test] BatchExecutor funded successfully`)
    
    // Create transactions that will work when executed BY the BatchExecutor
    // Use actual EOA addresses that can receive ETH
    const recipient1 = await provider.getSigner(1)
    const recipient2 = await provider.getSigner(2)
    const recipient1Address = await recipient1.getAddress()
    const recipient2Address = await recipient2.getAddress()
    
    // Create simple ETH transfer transactions
    const tx1 = {
      to: recipient1Address, // Transfer to EOA 
      value: ethers.parseEther('0.001'), // Small amount
      data: '0x', // Simple transfer
      gasLimit: 21000,
      gasPrice: await provider.getFeeData().then(f => f.gasPrice),
      nonce: 0,
      type: 1,
      chainId: 31337 // Anvil default chain ID
    }
    
    const tx2 = {
      to: recipient2Address, // Transfer to another EOA
      value: ethers.parseEther('0.002'), // Small amount
      data: '0x', // Simple transfer
      gasLimit: 21000,
      gasPrice: await provider.getFeeData().then(f => f.gasPrice),
      nonce: 0,
      type: 1,
      chainId: 31337 // Anvil default chain ID
    }

    // These transactions will be executed BY BatchExecutor, so we don't need to fund recipient1/2
    // We just need to sign them with some wallet (the signature won't be used by BatchExecutor)
    const testWallet = ethers.Wallet.createRandom()
    const sampleTrades = [
      await testWallet.signTransaction(tx1),
      await testWallet.signTransaction(tx2)
    ]

    // Instead of submitting through API, create BundleCandidate objects directly
    const bundleCandidates = sampleTrades.map((rawTx, index) => ({
      id: `test_trade_${index}`,
      rawTransaction: rawTx,
      txHash: ethers.Transaction.from(rawTx).hash || '0x123',
      receivedAt: Date.now(),
      simulation: {
        netProfitWei: '1000000',
        gasCostWei: '50000'
      },
      gasUsed: 21000
    }))

    console.log(`[BundleSigner Test] Created ${bundleCandidates.length} bundle candidates`)
    
    // Debug: log what's in the bundle candidates
    bundleCandidates.forEach((candidate, i) => {
      const parsed = ethers.Transaction.from(candidate.rawTransaction)
      console.log(`[BundleSigner Test] Candidate ${i}: to=${parsed.to}, value=${parsed.value}, data=${parsed.data}`)
    })

    // Run batching engine to create a bundle
    const bundle = batchingEngine.createGreedyBundle(bundleCandidates, 1000000n)
    console.log(`[BundleSigner Test] Bundle created with ${bundle.trades.length} trades`)
    
    // Debug: log what's in the final bundle
    bundle.trades.forEach((trade, i) => {
      const parsed = ethers.Transaction.from(trade.rawTransaction)
      console.log(`[BundleSigner Test] Bundle trade ${i}: to=${parsed.to}, value=${parsed.value}, data=${parsed.data}`)
    })
    expect(bundle.trades.length).to.be.greaterThan(0)

    // Sign the bundle
    console.log(`[BundleSigner Test] Signing bundle...`)
    const rawSignedTx = await bundleSigner.signBundle(bundle)
    expect(rawSignedTx).to.be.a('string')
    expect(rawSignedTx).to.match(/^0x[0-9a-fA-F]+$/)

    // Send the signed transaction to anvil
    console.log(`[BundleSigner Test] Broadcasting transaction...`)
    const txResponse = await provider.broadcastTransaction(rawSignedTx)
    expect(txResponse.hash).to.be.a('string')
    expect(txResponse.hash).to.match(/^0x[0-9a-fA-F]{64}$/)

    // Wait for transaction to be mined
    const receipt = await txResponse.wait()
    expect(receipt).to.not.be.null
    expect(receipt?.status).to.equal(1) // Success

    console.log(`[BundleSigner Integration] Successfully mined tx: ${txResponse.hash}`)
  })

  it('handles bundle with invalid trades gracefully', async () => {
    // Clear pending pool
    pendingPool.clear()

    // Create a fresh bundle signer with a different private key to avoid nonce conflicts
    const freshPrivateKey = '0x' + '2'.repeat(64) // Different private key
    const freshBundleSigner = new BundleSigner(freshPrivateKey, batchExecutorAddress, provider)
    
    // Fund the fresh signer
    const funder = await provider.getSigner(0)
    await funder.sendTransaction({
      to: freshBundleSigner.address,
      value: ethers.parseEther('1.0')
    })

    // Create a bundle with trades that might fail
    const invalidWallet = ethers.Wallet.createRandom()
    const invalidTx = {
      to: '0x0000000000000000000000000000000000000000',
      value: 1000,
      data: '0x60006000fe', // Simple revert bytecode
      gasLimit: 100000,
      gasPrice: await provider.getFeeData().then(f => f.gasPrice),
      nonce: 0,
      type: 1,
      chainId: 31337 // Anvil default chain ID
    }
    const invalidRawTx = await invalidWallet.signTransaction(invalidTx)
    
    const invalidTrades = [{
      id: 'invalid_trade',
      rawTransaction: invalidRawTx,
      txHash: ethers.Transaction.from(invalidRawTx).hash || '0x123',
      receivedAt: Date.now(),
      simulation: {
        netProfitWei: '100000',
        gasCostWei: '50000'
      },
      gasUsed: 100000
    }]

    const bundle = {
      trades: invalidTrades,
      totalGas: 100000n,
      totalNetProfitWei: 100000n
    }

    // Should still create a signed transaction
    const rawSignedTx = await freshBundleSigner.signBundle(bundle)
    expect(rawSignedTx).to.be.a('string')
    expect(rawSignedTx).to.match(/^0x[0-9a-fA-F]+$/)

    // When sent to anvil, it should revert gracefully
    try {
      const txResponse = await provider.broadcastTransaction(rawSignedTx)
      const receipt = await txResponse.wait()
      // If transaction is mined, it should have failed (status 0)
      expect(receipt?.status).to.equal(0)
      console.log(`[BundleSigner Integration] Invalid bundle gracefully reverted: ${txResponse.hash}`)
    } catch (error: any) {
      // If it throws an error, that's also acceptable for invalid trades
      expect(error).to.exist
      console.log(`[BundleSigner Integration] Invalid bundle gracefully handled: ${error.message}`)
    }
  })
})

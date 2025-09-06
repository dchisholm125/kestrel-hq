import { expect } from 'chai'
import * as ethers from 'ethers'
import { BundleSigner, Bundle } from '../../src/services/BundleSigner'
import { BundleCandidate } from '../../src/services/BatchingEngine'

describe('BundleSigner (unit)', () => {
  let bundleSigner: BundleSigner
  let burnerPrivateKey: string
  let batchExecutorAddress: string
  
  beforeEach(() => {
    // Generate a temporary burner private key for testing
    burnerPrivateKey = ethers.Wallet.createRandom().privateKey
    // Mock BatchExecutor contract address
    batchExecutorAddress = '0x1234567890123456789012345678901234567890'
    
    bundleSigner = new BundleSigner(burnerPrivateKey, batchExecutorAddress)
  })

  it('signs a bundle and returns a valid raw transaction string', async () => {
    // Create valid raw transactions for testing
    const wallet1 = ethers.Wallet.createRandom()
    const wallet2 = ethers.Wallet.createRandom()
    
    const tx1 = {
      to: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH contract
      value: ethers.parseEther('1.0'),
      data: '0xd0e30db0', // deposit() function
      gasLimit: 50000,
      gasPrice: 1,
      nonce: 0,
      type: 1,
      chainId: 31337 // Anvil default chain ID
    }
    
    const tx2 = {
      to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC contract
      value: 0,
      data: '0xa9059cbb000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266000000000000000000000000000000000000000000000000000000174876e800', // transfer function
      gasLimit: 75000,
      gasPrice: 1,
      nonce: 0,
      type: 1,
      chainId: 31337 // Anvil default chain ID
    }

    const rawTx1 = await wallet1.signTransaction(tx1)
    const rawTx2 = await wallet2.signTransaction(tx2)

    // Create a mock bundle with sample trades
    const mockTrades: BundleCandidate[] = [
      {
        id: 'trade_1',
        rawTransaction: rawTx1,
        txHash: ethers.Transaction.from(rawTx1).hash || '0xabc123',
        receivedAt: Date.now(),
        simulation: {
          netProfitWei: '1000000000000000',
          gasCostWei: '21000'
        },
        gasUsed: 50000
      },
      {
        id: 'trade_2', 
        rawTransaction: rawTx2,
        txHash: ethers.Transaction.from(rawTx2).hash || '0xdef456',
        receivedAt: Date.now(),
        simulation: {
          netProfitWei: '2000000000000000',
          gasCostWei: '35000'
        },
        gasUsed: 75000
      }
    ]

    const mockBundle: Bundle = {
      trades: mockTrades,
      totalGas: 125000n,
      totalNetProfitWei: 3000000000000000n
    }

    // Sign the bundle
    const rawTx = await bundleSigner.signBundle(mockBundle)

    // Assert that we get a valid 0x-prefixed raw transaction string
    expect(rawTx).to.be.a('string')
    expect(rawTx).to.match(/^0x[0-9a-fA-F]+$/)
    expect(rawTx.length).to.be.greaterThan(2) // More than just "0x"

    // Decode the raw transaction
    const decodedTx = ethers.Transaction.from(rawTx)

    // Assert the from address matches our burner wallet
    const expectedAddress = new ethers.Wallet(burnerPrivateKey).address
    expect(decodedTx.from).to.equal(expectedAddress)

    // Assert the to address matches our BatchExecutor contract
    expect(decodedTx.to).to.equal(batchExecutorAddress)

    // Assert the data field contains the executeBatch function signature
    expect(decodedTx.data).to.match(/^0x[0-9a-fA-F]+$/)
    // executeBatch function selector is the first 4 bytes (8 hex chars after 0x)
    const functionSelector = decodedTx.data.slice(0, 10)
    
    // Calculate expected function selector for executeBatch
    const iface = new ethers.Interface(['function executeBatch((address target, uint256 value, bytes data)[] calls) external payable returns (bytes[] memory results)'])
    const expectedSelector = iface.getFunction('executeBatch')!.selector
    expect(functionSelector).to.equal(expectedSelector)
  })

  it('handles empty bundle gracefully', async () => {
    const emptyBundle: Bundle = {
      trades: [],
      totalGas: 0n,
      totalNetProfitWei: 0n
    }

    const rawTx = await bundleSigner.signBundle(emptyBundle)
    
    expect(rawTx).to.be.a('string')
    expect(rawTx).to.match(/^0x[0-9a-fA-F]+$/)
    
    const decodedTx = ethers.Transaction.from(rawTx)
    expect(decodedTx.to).to.equal(batchExecutorAddress)
    expect(decodedTx.from).to.equal(new ethers.Wallet(burnerPrivateKey).address)
  })

  it('exposes the signer address', () => {
    const expectedAddress = new ethers.Wallet(burnerPrivateKey).address
    expect(bundleSigner.address).to.equal(expectedAddress)
  })
})

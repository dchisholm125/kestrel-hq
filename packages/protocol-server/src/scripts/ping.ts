import { JsonRpcProvider, Wallet } from 'ethers'

// Connect to local anvil
const localProvider = new JsonRpcProvider('http://127.0.0.1:8545')

async function ping() {
  try {
    console.log('[ping] Connecting to anvil...')

    // Get the first account from anvil (it has pre-funded accounts)
    const accounts = await localProvider.listAccounts()
    console.log(`[ping] Found ${accounts.length} accounts`)

    if (accounts.length === 0) {
      console.error('[ping] No accounts found on anvil')
      return
    }

    const fromAddress = accounts[0].address
    console.log(`[ping] Using account: ${fromAddress}`)

    // Send a simple transaction to create a new block
    console.log('[ping] Sending ping transaction...')
    const tx = await localProvider.send('eth_sendTransaction', [{
      from: fromAddress,
      to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', // Random address
      value: '0x1', // 1 wei
      data: '0x', // No data
    }])

    console.log(`[ping] Transaction sent: ${tx}`)
    console.log('[ping] Ping complete! Bots should have detected the new block.')

  } catch (error: any) {
    console.error('[ping] Error:', error.message)
  }
}

if (require.main === module) {
  ping().catch((e) => {
    console.error('[ping] Fatal error', e)
    process.exit(1)
  })
}

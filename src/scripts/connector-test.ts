import NodeConnector from '../services/NodeConnector'

;(async () => {
  try {
    const nc = NodeConnector.getInstance()
    const provider = await nc.getProvider()
  console.log('Provider connected, chainId:', await provider.getNetwork().then((n: { chainId: bigint }) => n.chainId))
    const unsub = nc.subscribeToNewBlocks()

    console.log('Subscribed to new blocks for 5s...')
    setTimeout(() => {
      console.log('Unsubscribing and exiting')
      unsub()
      process.exit(0)
    }, 5000)
  } catch (err) {
    console.error('Connector test failed:', err)
    process.exit(1)
  }
})()

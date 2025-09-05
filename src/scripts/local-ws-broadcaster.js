const WebSocket = require('ws');
const axios = require('axios');

const BIND_HOST = process.env.BROADCASTER_HOST || '127.0.0.1'
const BIND_PORT = Number(process.env.BROADCASTER_PORT || 8546)

const wss = new WebSocket.Server({ host: BIND_HOST, port: BIND_PORT });

let lastBlock = null;

wss.on('connection', (ws, req) => {
  const remote = (req && req.socket && req.socket.remoteAddress) || 'local'
  console.log(`[broadcaster] client connected from ${remote} (clients=${wss.clients.size})`)
  ws.send(JSON.stringify({ type: 'welcome', port: BIND_PORT }))
  ws.on('close', () => console.log(`[broadcaster] client disconnected (clients=${wss.clients.size})`))
})

const pollAnvil = async () => {
  try {
    const response = await axios.post('http://127.0.0.1:8545', {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 3000 })

    if (!response || !response.data || typeof response.data.result === 'undefined') {
      throw new Error('invalid response from anvil')
    }

    const blockNumber = parseInt(response.data.result, 16)
    if (Number.isNaN(blockNumber)) throw new Error('invalid block number')

    if (blockNumber !== lastBlock) {
      lastBlock = blockNumber
      const payload = JSON.stringify({ type: 'block', blockNumber })
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(payload)
      })
      console.log('[broadcaster] new block:', blockNumber)
    }
  } catch (error) {
    console.error('[broadcaster] Error polling block number:', error && error.message ? error.message : error)
  }
}

setInterval(pollAnvil, 2000)
// Do an initial immediate poll
pollAnvil()

console.log(`WebSocket broadcaster started on ${BIND_HOST}:${BIND_PORT}`)

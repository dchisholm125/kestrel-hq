const http = require('http')
const createApp = require('../src/http').createApp

async function main() {
  const app = createApp()
  const server = http.createServer(app)
  await new Promise((r)=>server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  console.log('listening', port)
  const body = JSON.stringify({ intent_id: 'dbg-1' })
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }
  const req = http.request(`http://127.0.0.1:${port}/intent`, opts, (res) => {
    let data = ''
    res.on('data', (c)=>data+=c)
    res.on('end', ()=>{
      console.log('status', res.statusCode)
      console.log('body', data)
      server.close()
    })
  })
  req.on('error', (e)=>{ console.error('reqErr', e); server.close() })
  req.write(body)
  req.end()
}

main().catch(e=>{ console.error(e); process.exit(1) })

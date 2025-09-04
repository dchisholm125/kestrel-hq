import express, { Request, Response } from 'express'
import { ENV } from './config'
import { validateSubmitBody } from './validators/submitValidator'
import TransactionSimulator from './services/TransactionSimulator'
import { pendingPool } from './services/PendingPool'

const app = express()
const port = ENV.API_SERVER_PORT || ENV.PORT || 3000

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK' })
})

app.get('/', (req: Request, res: Response) => {
  res.send('Hello, Kestrel Protocol!')
})

// parse JSON bodies
app.use(express.json())

// POST /submit-tx - receive trade submissions from bots
type SubmitTxBody = {
  to?: string
  data?: string
  value?: string | number
  from?: string
  /**
   * The signed, serialized transaction as a 0x-prefixed hex string (RLP or typed envelope).
   * This API accepts only `rawTransaction` to avoid ambiguity.
   */
  rawTransaction?: string
}

app.post('/submit-tx', (req: Request<Record<string, unknown>, Record<string, unknown>, SubmitTxBody>, res: Response) => {
  const body = req.body

  const result = validateSubmitBody(body)
  if (!result.valid) {
    return res.status(400).json({ error: result.error })
  }

  const id = `sub_${Date.now()}_${Math.floor(Math.random() * 100000)}`
  console.info('[submit-tx] received submission', { id, rawPreview: (result.raw || '').slice(0, 20) })

  ;(async () => {
    try {
      const sim = TransactionSimulator.getInstance()
      const simRes = await sim.analyze(result.raw)
      if (simRes.decision === 'ACCEPT') {
        // Add to pending pool
        try {
          pendingPool.addTrade({
            id,
            rawTransaction: result.raw,
            txHash: (simRes as any).txHash || 'unknown',
            receivedAt: Date.now(),
            simulation: {
              grossProfit: (simRes as any).grossProfit,
              grossProfitWei: (simRes as any).grossProfitWei,
              gasCostWei: (simRes as any).gasCostWei,
              netProfitWei: (simRes as any).netProfitWei
            }
          })
        } catch (e) {
          console.error('[submit-tx] failed adding trade to pool', e)
        }
        return res.status(200).json({ id, status: 'accepted', simulation: 'ACCEPT', grossProfit: (simRes as any).grossProfit, grossProfitWei: (simRes as any).grossProfitWei, gasCostWei: (simRes as any).gasCostWei, netProfitWei: (simRes as any).netProfitWei, deltas: (simRes as any).deltas, txHash: (simRes as any).txHash })
      }
      return res.status(400).json({ id, status: 'rejected', simulation: 'REJECT', reason: simRes.reason, grossProfitWei: (simRes as any).grossProfitWei, gasCostWei: (simRes as any).gasCostWei, netProfitWei: (simRes as any).netProfitWei, txHash: (simRes as any).txHash })
    } catch (e) {
      console.error('[submit-tx] simulation failed', e)
      return res.status(500).json({ error: 'simulation failed' })
    }
  })()
})

// Only start server when this file is executed directly. Export app for tests.
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`)
  })
}

export default app

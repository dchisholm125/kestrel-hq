/**
 * HTTP router for protocol-server
 * Exposes `createApp()` to allow tests to mount the app without starting a server.
 */
import express from 'express'
import corr from './middleware/corr'
import postIntent from './submit'
import getStatus from './status'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.use(corr)

  // Attach handlers
  app.post('/intent', postIntent)
  app.get('/status/:intent_id', getStatus)

  // Small human-friendly confirmation logging for incoming requests
  // This prints a short line after the response is sent so human operators
  // can see quick confirmation in the server console without parsing JSON.
  app.use((req, res, next) => {
    const start = Date.now()
    res.on('finish', () => {
      try {
        const latency = Date.now() - start
        // Attempt to access corr_id set by middleware
        const corr_id = (req as any).corr_id || '-'
        // Friendly one-line output similar to liveProof's small console lines
        // Example: "[http] POST /intent 201 corr=corr_01abc 34ms"
        // eslint-disable-next-line no-console
        console.log(`[http] ${req.method} ${req.path} ${res.statusCode} corr=${corr_id} ${latency}ms`)
      } catch (e) {}
    })
    next()
  })

  return app
}

export default createApp

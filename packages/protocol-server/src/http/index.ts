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

  app.post('/intent', postIntent)
  app.get('/status/:intent_id', getStatus)

  return app
}

export default createApp

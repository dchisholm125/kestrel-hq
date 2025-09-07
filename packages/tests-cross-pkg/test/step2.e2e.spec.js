/*
 * Cross-package E2E (JS guarded): run with RUN_CROSS_PKG=1 pnpm test
 * This test uses require-time mocks to avoid compiling the full TypeScript
 * project and to keep CI fast and deterministic. It's intentionally skipped
 * unless the RUN_CROSS_PKG env var is set.
 */

const fs = require('fs')
const path = require('path')
const request = require('supertest')

// prefer built JS under dist if present so Jest doesn't try to parse TypeScript sources
const builtIndex = path.resolve(__dirname, '../../protocol-server/dist/protocol-server/src/index.js')
let useDist = fs.existsSync(builtIndex)
// allow opting into loading TypeScript sources (for deterministic, in-process mocks)
if (process.env.USE_SRC_TS === '1') {
  // register ts-node to allow requiring .ts files
  try {
    require('ts-node').register({ transpileOnly: true });
    useDist = false
  }
  catch (e) {
    // fallback to dist if ts-node is not available
    useDist = fs.existsSync(builtIndex)
  }
}
const basePath = useDist ? '../../protocol-server/dist/protocol-server/src' : '../../protocol-server/src'

const shouldRun = process.env.RUN_CROSS_PKG === '1'
;(shouldRun ? describe : describe.skip)('cross-package step2 ladder and error envelopes', () => {
  beforeEach(() => jest.resetModules())

  test('green-ladder: valid intent advances through conveyor to QUEUED', async () => {
    const transitions = []

    jest.doMock(require.resolve(`${basePath}/fsm/transitionExecutor`), () => ({
      advanceIntent: jest.fn(async (opts) => { transitions.push(opts.to); return opts.to })
    }))

    const metricsMock = {
      incrementReceived: jest.fn(),
      incrementAccepted: jest.fn(),
      incrementRejected: jest.fn(),
      incReject: jest.fn(),
      observeStage: jest.fn(),
      observeDecisionLatency: jest.fn(),
      getPromMetrics: jest.fn(async () => 'kestrel_intents_total 1\\nkestrel_rejects_total 0')
    }

  jest.doMock(require.resolve(`${basePath}/stages/screen`), () => ({ screenIntent: jest.fn(async (ctx) => { const a = require(require.resolve(`${basePath}/fsm/transitionExecutor`)).advanceIntent; await a({ intentId: ctx.intent.intent_id || ctx.intent.id, to: 'SCREENED', corr_id: ctx.corr_id }) }) }))
  jest.doMock(require.resolve(`${basePath}/stages/validate`), () => ({ validateIntent: jest.fn(async (ctx) => { const a = require(require.resolve(`${basePath}/fsm/transitionExecutor`)).advanceIntent; await a({ intentId: ctx.intent.intent_id || ctx.intent.id, to: 'VALIDATED', corr_id: ctx.corr_id }) }) }))
  jest.doMock(require.resolve(`${basePath}/stages/enrich`), () => ({ enrichIntent: jest.fn(async (ctx) => { const a = require(require.resolve(`${basePath}/fsm/transitionExecutor`)).advanceIntent; await a({ intentId: ctx.intent.intent_id || ctx.intent.id, to: 'ENRICHED', corr_id: ctx.corr_id }) }) }))
  jest.doMock(require.resolve(`${basePath}/stages/policy`), () => ({ policyIntent: jest.fn(async (ctx) => { const a = require(require.resolve(`${basePath}/fsm/transitionExecutor`)).advanceIntent; await a({ intentId: ctx.intent.intent_id || ctx.intent.id, to: 'QUEUED', corr_id: ctx.corr_id }) }) }))

    const app = require(`${basePath}/index`).default
    // runtime override: replace MetricsTracker.getInstance to return our mock
    try {
      const MT = require(require.resolve(`${basePath}/services/MetricsTracker`))
      if (MT && MT.default) MT.default.getInstance = () => metricsMock
    } catch (e) {}
    const body = { intent_id: 'e2e-1', payload: { from: '0xabc', to: '0xdef' } }
    const res = await request(app).post('/intent').send(body)
    if (![200, 201].includes(res.status)) {
      // debug output to diagnose server-side error
      // eslint-disable-next-line no-console
      console.error('E2E DEBUG /intent unexpected status', res.status, 'body:', res.body, 'text:', res.text && res.text.slice && res.text.slice(0, 400))
    }
    expect([200,201]).toContain(res.status)
    // ensure the pipeline invoked transitions in expected order
    expect(transitions).toEqual(['SCREENED', 'VALIDATED', 'ENRICHED', 'QUEUED'])
  })

  test('status-surface: GET /status/:id returns state and last_reason for rejected intents', async () => {
    jest.resetModules()
    const transitions = []
    jest.doMock(`${basePath}/fsm/transitionExecutor`, () => ({ advanceIntent: jest.fn(async (opts) => { transitions.push(opts.to); return opts.to }) }))

    const app = require(`${basePath}/index`).default
    try {
      const MT = require(require.resolve(`${basePath}/services/MetricsTracker`))
      if (MT && MT.default) MT.default.getInstance = () => ({ getPromMetrics: async () => '' })
    } catch (e) {}
    // create a rejected row in intentStore
    const store = require(`${basePath}/services/IntentStore`).intentStore
    const row = { intent_id: 'status-1', request_hash: 'h1', correlation_id: 'corr-1', state: 'REJECTED', reason_code: 'VALIDATION_SIGNATURE_FAIL', received_at: Date.now(), payload: {} }
    store.put(row)
    const res = await request(app).get(`/status/${row.intent_id}`)
    expect(res.status).toBe(200)
    expect(res.body.state).toBe('REJECTED')
    expect(res.body.last_reason).toBeDefined()
  })

  test('metrics-smoke: /metrics contains intent/reject metrics', async () => {
    jest.resetModules()
    const metricsMock = {
      getPromMetrics: jest.fn(async () => 'kestrel_intents_total{decision="accepted"} 1\\nkestrel_rejects_total{reason_code="SCREEN_TOO_LARGE"} 1')
    }
    const app = require(`${basePath}/index`).default
    try { const MT = require(require.resolve(`${basePath}/services/MetricsTracker`)); if (MT && MT.default) MT.default.getInstance = () => metricsMock } catch (e) {}
    const res = await request(app).get('/metrics')
    if (res.status !== 200) {
      // eslint-disable-next-line no-console
      console.error('E2E DEBUG /metrics unexpected status', res.status, 'body:', res.body, 'text:', res.text && res.text.slice && res.text.slice(0, 400))
    }
    expect(res.status).toBe(200)
    expect(res.text).toContain('kestrel_intents_total')
    expect(res.text).toContain('kestrel_rejects_total')
  })
})

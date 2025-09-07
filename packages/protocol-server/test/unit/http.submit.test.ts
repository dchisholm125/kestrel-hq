import request from 'supertest'

// Note: require createApp inside each test after any jest.doMock calls so
// mocks are applied before module load.

describe('http submit/status handlers', () => {
  beforeEach(() => {
    jest.resetModules()
    // reset in-memory store
    const store = require('../../src/services/IntentStore').intentStore
    // naive clear by re-instantiating maps
    ;(store as any)['byId'] = new Map()
    ;(store as any)['byHash'] = new Map()
  })

  test('corr-id: absent header generates id', async () => {
  // mock all stages to avoid touching DB
  jest.doMock('../../src/stages/screen', () => ({ screenIntent: async (ctx: any) => { const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); if (r) { r.state = 'SCREENED'; store.put(r) } } }))
  jest.doMock('../../src/stages/validate', () => ({ validateIntent: async (ctx: any) => { const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); if (r) { r.state = 'VALIDATED'; store.put(r) } } }))
  jest.doMock('../../src/stages/enrich', () => ({ enrichIntent: async (ctx: any) => { const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); if (r) { r.state = 'ENRICHED'; store.put(r) } } }))
  jest.doMock('../../src/stages/policy', () => ({ policyIntent: async (ctx: any) => { const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); if (r) { r.state = 'QUEUED'; store.put(r) } } }))
  const createApp = require('../../src/http').createApp
  const app = createApp()
  const res = await request(app).post('/intent').send({ intent_id: 't1' })
    expect([200,201]).toContain(res.status)
    // response should include correlation_id when accepted
    expect(res.body.correlation_id).toBeDefined()
    expect(typeof res.body.correlation_id).toBe('string')
  })

  test('pipeline-order: stages called in order and single transition per rung', async () => {
    // mock stages to push order
    const calls: string[] = []
  jest.doMock('../../src/stages/screen', () => ({ screenIntent: async (ctx: any) => { calls.push('screen'); const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); r.state = 'SCREENED'; store.put(r) } }))
  jest.doMock('../../src/stages/validate', () => ({ validateIntent: async (ctx: any) => { calls.push('validate'); const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); r.state = 'VALIDATED'; store.put(r) } }))
  jest.doMock('../../src/stages/enrich', () => ({ enrichIntent: async (ctx: any) => { calls.push('enrich'); const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); r.state = 'ENRICHED'; store.put(r) } }))
  jest.doMock('../../src/stages/policy', () => ({ policyIntent: async (ctx: any) => { calls.push('policy'); const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); r.state = 'QUEUED'; store.put(r) } }))

  const createApp = require('../../src/http').createApp
  const app = createApp()
  const res = await request(app).post('/intent').send({ intent_id: 't2' })
    expect(res.status).toBe(201)
    expect(calls).toEqual(['screen','validate','enrich','policy'])
    // ensure only one transition per stage by checking final state
  const r = require('../../src/services/IntentStore').intentStore.getById('t2')
    expect(r.state).toBe('QUEUED')
  })

  test('error-envelope-shape: reject on schema failure', async () => {
  const createApp = require('../../src/http').createApp
  const app = createApp()
    const res = await request(app).post('/intent').send({})
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.body.corr_id).toBeDefined()
    expect(res.body.state).toBeDefined()
    expect(res.body.reason).toBeDefined()
    expect(typeof res.body.reason.code).toBe('string')
  })

  test('latency-recorded: stage timers produce metrics samples', async () => {
    // create a metrics mock collecting observeStage calls
    const observed: Array<{stage:string,ms:number}> = []
    jest.doMock('../../src/services/MetricsTracker', () => {
      return {
        default: { getInstance: () => ({ observeStage: (stage:string, ms:number) => observed.push({stage,ms}), observeDecisionLatency: () => {}, incrementAccepted: () => {}, incrementReceived: () => {} }) }
      }
    })

    // ensure we don't touch DB; mock all stages to noop that set state
  jest.doMock('../../src/stages/screen', () => ({ screenIntent: async (ctx: any) => { const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); if (r) { r.state = 'SCREENED'; store.put(r) } } }))
  jest.doMock('../../src/stages/validate', () => ({ validateIntent: async (ctx: any) => { const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); if (r) { r.state = 'VALIDATED'; store.put(r) } } }))
  jest.doMock('../../src/stages/enrich', () => ({ enrichIntent: async (ctx: any) => { const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); if (r) { r.state = 'ENRICHED'; store.put(r) } } }))
  jest.doMock('../../src/stages/policy', () => ({ policyIntent: async (ctx: any) => { const store = require('../../src/services/IntentStore').intentStore; const r = store.getById(ctx.intent.intent_id); if (r) { r.state = 'QUEUED'; store.put(r) } } }))
    const createApp = require('../../src/http').createApp
    // runtime override guard: ensure getInstance returns our mock
    try {
      const MT = require('../../src/services/MetricsTracker')
      if (MT && MT.default) MT.default.getInstance = () => ({ observeStage: (stage:string, ms:number) => observed.push({stage,ms}), observeDecisionLatency: () => {}, incrementAccepted: () => {}, incrementReceived: () => {} })
    } catch (e) {}
    const app = createApp()
  const res = await request(app).post('/intent').send({ intent_id: 't3' })
    expect([200,201]).toContain(res.status)
    // should have observed per-stage latencies
    expect(observed.length).toBeGreaterThanOrEqual(1)
    expect(observed.some(o => o.stage === 'screen')).toBeTruthy()
  })
})

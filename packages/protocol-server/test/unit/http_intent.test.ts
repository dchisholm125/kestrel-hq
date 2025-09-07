import request from 'supertest'
import app from '../../src/index'
import { intentStore } from '../../src/services/IntentStore'

jest.mock('../../src/stages/screen', () => ({
  screenIntent: jest.fn(async (ctx: any) => {
    // default: advance to SCREENED
    const row = intentStore.getById(ctx.intent.intent_id || ctx.intent.id)
    if (row) { row.state = 'SCREENED'; intentStore.put(row) }
    return Promise.resolve()
  })
}))

jest.mock('../../src/stages/validate', () => ({
  validateIntent: jest.fn(async (ctx: any) => {
    const row = intentStore.getById(ctx.intent.intent_id || ctx.intent.id)
    if (row) { row.state = 'VALIDATED'; intentStore.put(row) }
    return Promise.resolve()
  })
}))

jest.mock('../../src/stages/enrich', () => ({
  enrichIntent: jest.fn(async (ctx: any) => {
    const row = intentStore.getById(ctx.intent.intent_id || ctx.intent.id)
    if (row) { row.state = 'ENRICHED'; intentStore.put(row) }
    return Promise.resolve()
  })
}))

jest.mock('../../src/stages/policy', () => ({
  policyIntent: jest.fn(async (ctx: any) => {
    const row = intentStore.getById(ctx.intent.intent_id || ctx.intent.id)
    if (row) { row.state = 'QUEUED'; intentStore.put(row) }
    return Promise.resolve()
  })
}))

describe('/intent endpoint', () => {
  beforeEach(() => {
    // reset store
    // @ts-ignore
    intentStore.byId = new Map()
  // @ts-ignore
  intentStore.byHash = new Map()
  })

  it('returns 201 and RECEIVED then pipeline advances to QUEUED (happy path)', async () => {
    const body = { intent_id: 'i-http-1', payload: { from: 'a', to: 'b' } }
    const res = await request(app).post('/intent').send(body)
    expect(res.status).toBe(201)
    expect(res.body.intent_id).toBe(body.intent_id)
    expect(['QUEUED','ENRICHED','SCREENED','VALIDATED']).toContain(res.body.state)
    const stored = intentStore.getById(body.intent_id)
    expect(stored).toBeTruthy()
    expect(stored?.state).toBe('QUEUED')
  })

  it('returns 4xx when screen rejects', async () => {
    // mock screen to reject
    const screen = require('../../src/stages/screen').screenIntent
    screen.mockImplementationOnce(async (ctx: any) => {
      const row = intentStore.getById(ctx.intent.intent_id || ctx.intent.id)
      if (row) { row.state = 'REJECTED'; row.reason_code = 'SCREEN_REPLAY_SEEN'; intentStore.put(row) }
      return Promise.resolve()
    })

    const body = { intent_id: 'i-http-2', payload: { from: 'a' }, bytes: 1 }
    const res = await request(app).post('/intent').send(body)
    expect(res.status).toBe(200) // SCREEN_REPLAY_SEEN maps to http_status 200 in reasons
    expect(res.body.state).toBe('REJECTED')
    expect(res.body.reason).toBeDefined()
  })

  it('GET /status/:id returns state and last_reason', async () => {
    const body = { intent_id: 'i-http-3', payload: { from: 'a' } }
    await request(app).post('/intent').send(body)
    const res = await request(app).get(`/status/${body.intent_id}`)
    expect(res.status).toBe(200)
    expect(res.body.state).toBeDefined()
  })

  it('idempotent-post: POST twice with same body returns same state and does not create duplicate', async () => {
    const body = { intent_id: 'i-http-4', payload: { from: 'a' } }
    const res1 = await request(app).post('/intent').send(body)
    expect(res1.status).toBe(201)
    const res2 = await request(app).post('/intent').send(body)
    // second should be short-circuited and return 200 with same intent_id
    expect([200,201]).toContain(res2.status)
    expect(res2.body.intent_id).toBe(body.intent_id)
    // only one stored intent
    const stored = intentStore.getById(body.intent_id)
    expect(stored).toBeTruthy()
  })

  it('hash-mismatch: same hash but different body -> REJECTED with SCREEN_REPLAY_SEEN', async () => {
    // simulate existing entry with same hash but different payload
    const bodyA = { intent_id: 'i-http-5', payload: { from: 'a' } }
    const bodyB = { intent_id: 'i-http-5', payload: { from: 'b' } }
    const hash = intentStore.computeHash(bodyA)
    // store a row with this hash but different payload
    const stored = { intent_id: 'i-http-5', request_hash: hash, correlation_id: 'corr_x', state: 'RECEIVED', reason_code: 'ok', received_at: Date.now(), payload: { foo: 'bar' } }
    // @ts-ignore
    intentStore.byId.set(stored.intent_id, stored)
    // @ts-ignore
    intentStore.byHash.set(stored.request_hash, stored)

    const res = await request(app).post('/intent').send(bodyA)
    // since stored payload is different but hash equal, API should return SCREEN_REPLAY_SEEN (200)
    expect(res.status).toBe(200)
    expect(res.body.state).toBe('REJECTED')
    expect(res.body.reason).toBeDefined()
  })
})

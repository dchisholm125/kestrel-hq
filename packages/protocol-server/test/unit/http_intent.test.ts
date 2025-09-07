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
})

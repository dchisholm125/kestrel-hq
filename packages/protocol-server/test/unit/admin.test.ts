import 'jest'

describe('db admin helpers', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  test('refreshIntentLastEvent executes refresh SQL', async () => {
    let capturedSql: string | null = null

    jest.doMock('../../src/db/db', () => ({
      db: {
        tx: async (fn: Function) => {
          const t: any = {
            none: async (sql: string) => { capturedSql = sql }
          }
          return fn(t)
        }
      }
    }))

    const admin = await import('../../src/db/admin')
    await admin.refreshIntentLastEvent()
    expect(capturedSql).toBeDefined()
    expect(capturedSql!.toUpperCase()).toContain('REFRESH MATERIALIZED VIEW')
    expect(capturedSql).toContain('intent_last_event')
  })
})

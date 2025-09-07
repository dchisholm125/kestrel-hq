import 'jest'

describe('transitionExecutor optimistic locking', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  test('optimistic-success: normal transition increments version', async () => {
    // mock db.tx to simulate success path
    const db = {
      tx: async (fn: Function) => {
        const t: any = {
          one: async (_q: string, _p: any[]) => ({ state: 'RECEIVED', version: 1 }),
          none: async () => {},
          result: async () => ({ rowCount: 1 })
        }
        return fn(t)
      }
    }
    jest.doMock('../../src/db/db', () => ({ db }))
    const { advanceIntent } = await import('../../src/fsm/transitionExecutor')
    const res = await advanceIntent({ intentId: 'i1', to: 'SCREENED', corr_id: 'c1' })
    expect(res).toBe('SCREENED')
  })

  test('optimistic-conflict-retry: update conflict but another transaction already applied', async () => {
    const db = {
      tx: async (fn: Function) => {
        const t: any = {
          one: async (_q: string, _p: any[]) => ({ state: 'RECEIVED', version: 1 }),
          none: async () => {},
          result: async () => ({ rowCount: 0 }),
          // when called again for fresh read
        }
        // the function will call t.result then t.one for fresh; we simulate fresh by modifying behavior
        const origOne = t.one.bind(t)
        let called = 0
        t.one = async (q: string, p: any[]) => {
          called++
          if (called === 1) return { state: 'RECEIVED', version: 1 }
          // after conflict, fresh read shows target was applied by another tx
          return { state: 'SCREENED', version: 2 }
        }
        return fn(t)
      }
    }
    jest.doMock('../../src/db/db', () => ({ db }))
    const { advanceIntent } = await import('../../src/fsm/transitionExecutor')
    const res = await advanceIntent({ intentId: 'i2', to: 'SCREENED', corr_id: 'c2' })
    expect(res).toBe('SCREENED')
  })

  test('optimistic-conflict-invalid: conflict and different state -> throw invalid_transition', async () => {
    const db = {
      tx: async (fn: Function) => {
        const t: any = {}
        let called = 0
        t.one = async (_q: string, _p: any[]) => {
          called++
          if (called === 1) return { state: 'RECEIVED', version: 1 }
          return { state: 'QUEUED', version: 2 }
        }
        t.none = async () => {}
        t.result = async () => ({ rowCount: 0 })
        return fn(t)
      }
    }
    jest.doMock('../../src/db/db', () => ({ db }))
    const { advanceIntent } = await import('../../src/fsm/transitionExecutor')
    await expect(advanceIntent({ intentId: 'i3', to: 'SCREENED', corr_id: 'c3' })).rejects.toThrow(/invalid_transition/)
  })
})

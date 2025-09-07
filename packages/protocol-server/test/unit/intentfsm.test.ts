import { intentStore } from '../../src/services/IntentStore'
import { intentFSM } from '../../src/services/IntentFSM'
import { IntentState } from '../../../dto/src/enums'
import 'jest'

describe('IntentFSM', () => {
  beforeEach(() => {
    // reset store
    // @ts-ignore
    intentStore.byId = new Map()
  })

  it('rejects illegal transitions and sets REJECTED', () => {
    const row = { intent_id: 'i1', request_hash: 'h', correlation_id: 'c', state: IntentState.RECEIVED, reason_code: 'ok', received_at: Date.now(), payload: {} }
    intentStore.put(row as any)
    const res = intentFSM.transition('i1', IntentState.INCLUDED as any)
    expect(res.ok).toBe(false)
    const stored = intentStore.getById('i1')
    expect(stored?.state).toBe('REJECTED')
  })
})

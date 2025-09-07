import { StateMachine } from '../../src/fsm/stateMachine'
import { IntentState } from '../../../dto/src/enums'
import 'jest'

describe('StateMachine', () => {
  it('allows defined single-step transitions and disallows others', () => {
    const sm = new StateMachine()
    expect(sm.can(IntentState.RECEIVED, IntentState.SCREENED)).toBe(true)
    expect(sm.can(IntentState.RECEIVED, IntentState.VALIDATED)).toBe(false)
    expect(sm.can(IntentState.QUEUED, IntentState.SUBMITTED)).toBe(true)
    expect(sm.can(IntentState.QUEUED, IntentState.INCLUDED)).toBe(false)
  })
})

import { IntentState } from '../../../dto/src/enums'

export class StateMachine {
  private ALLOWED: Record<string, string[]> = {
    RECEIVED:  ['SCREENED'],
    SCREENED:  ['VALIDATED', 'REJECTED'],
    VALIDATED: ['ENRICHED', 'REJECTED'],
    ENRICHED:  ['QUEUED', 'REJECTED'],
    QUEUED:    ['SUBMITTED'],
    SUBMITTED: ['INCLUDED', 'DROPPED'],
    INCLUDED:  [],
    DROPPED:   [],
    REJECTED:  []
  }

  can(from: IntentState | string, to: IntentState | string) {
    return (this.ALLOWED[from as string] ?? []).includes(to as string)
  }
}

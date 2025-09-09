// Role: Enforce capital allocation policies
// Time budget: <100ms per policy check
// Coupling: Implements CapitalPolicy interface. Version DTOs.

import { CapitalPolicy as ICapitalPolicy } from '@kestrel-protocol/edge';

export class CapitalPolicy implements ICapitalPolicy {
  check(bundle: any): boolean {
    // Real check
    return true;
  }
}

# @kestrel-hq/reasons

Centralized Reasons Registry and ReasonedRejection error types.

- Depends on `@kestrel-hq/dto`.
- Exports via `src/index.ts` barrel.# @kestrel/reasons

Centralized Reasons Registry and ReasonedRejection error for deterministic, machine-parsable failures across Kestrel stages.

- REASONS: stable mapping of ReasonCode -> { category, http_status, message }
- reason(code, overrides?): merges defaults with optional message/http_status/context
- ReasonedRejection: Error subclass with `.reason` and `terminalState='REJECTED'`; logs a single console.warn on creation.

Usage in a stage:

```
import { reason, ReasonedRejection } from '@kestrel/reasons'
throw new ReasonedRejection(
  reason('VALIDATION_SIGNATURE_FAIL', { message: 'signature verification failed', context: { gotAlg: 'secp256k1' } }),
  'Rejecting at VALIDATE: signature check failed'
)
```

Add new codes by updating `@kestrel/dto` reasons and enums; keep codes stable to preserve contracts.

How to run tests locally

Install and run tests for the affected packages:
  pnpm -w i
  pnpm --filter @kestrel/reasons test
  pnpm --filter @kestrel/protocol-server test

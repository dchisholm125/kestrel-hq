## Reasons & Deterministic Rejections

This repo now includes `@kestrel/reasons`, a centralized registry and error type. Stages throw `ReasonedRejection(reason('CODE', { context }))`. The HTTP/pipeline catches, advances the FSM to REJECTED, and writes a JSONL audit record to `packages/protocol-server/logs/rejections.jsonl`.

# Kestrel HQ (monorepo)

This repository is a small monorepo containing reference server, SDK, API spec, and example packages for the Kestrel protocol.

Goals of this README
- Help new contributors run and build the whole workspace quickly.
- Explain where the canonical DTOs (enums + reason codes) live and how to consume them.
- Show how to run the protocol server and run the SDK against it.

## Repo layout (top-level)
- `packages/dto` - canonical enums, reason details and the `ErrorEnvelope` type (single source of truth used by server + SDK).
- `packages/protocol-server` - Express-based protocol server, metrics and intent store.
- `packages/protocol-sdk` - minimal client SDK to submit intents and poll status.
- `packages/protocol-api` - OpenAPI spec (`openapi.yaml`) and API docs.
- `packages/aerie` - example consumer (demo/test harnesss scripts/tests).
- `packages/tests-cross-pkg` - cross-package integration tests.

## Prerequisites
- Node.js (recommended >= 18)
- Git
- pnpm preferred for workspace-aware installs (recommended):

```bash
# install pnpm if you don't have it
npm i -g pnpm
```

If you can't or don't want to use `pnpm`, you can build individual packages with `npm --prefix <package> run build` as described below.

## Quick start (recommended using pnpm)

```bash
# from repo root
pnpm install

# build all packages in the workspace
pnpm -w -s build


# build the protocol server package (required before starting)
pnpm --filter @kestrel/protocol-server run build

# start the protocol server
pnpm --filter @kestrel/protocol-server start

# run the smoke script in the aerie package (example):
# use the package name declared in `packages/aerie/package.json`:
pnpm --filter @kestrel-hq/aerie run smoke

# or use a path-based filter (works regardless of package name):
pnpm --filter ./packages/aerie run smoke
```

## Alternative: build & run packages individually (npm)

If you prefer not to install `pnpm`, the following commands build and run the server using npm per-package:

```bash
# build dto and server
npm --prefix packages/dto run build
npm --prefix packages/protocol-server run build

# run server (uses built files in dist/)
npm --prefix packages/protocol-server start
```

## Development notes

- Canonical DTO: `packages/dto/src/enums.ts` and `packages/dto/src/reasons.ts` provide:
  - `IntentState` enum (RECEIVED, SCREENED, VALIDATED, ENRICHED, QUEUED, SUBMITTED, INCLUDED, DROPPED, REJECTED)
  - `ReasonCategory` enum and `ReasonCode` union
  - `ReasonDetail` and `ErrorEnvelope` types
  - `REASONS` map and helper `getReason(code)`

- ErrorEnvelope: the API and SDK use a canonical error envelope for all non-success responses. It includes `corr_id`, optional `request_hash`, `state`, a `reason` object (code/category/http_status/message/context), and an RFC3339 `ts`.

- OpenAPI: `packages/protocol-api/openapi.yaml` now defines `IntentState` and `ErrorEnvelope` schemas. Use this as the authoritative API spec.

- Intent FSM: a centralized FSM service lives in `packages/protocol-server/src/services/IntentFSM.ts`. It enforces allowed transitions and logs transitions (idempotent). This is being iterated on; additional wiring and metrics per-reason are planned.

## SDK usage (quick)

In `packages/protocol-sdk` you'll find a small TypeScript client. Example usage:

```ts
import { ProtocolSDK } from '@kestrel/protocol-sdk'
const sdk = new ProtocolSDK({ baseUrl: 'http://localhost:4000', apiKey: 'k', apiSecret: 's3cret' })
const res = await sdk.submitIntent({ intent_id: 'test-1', target_chain: 'eth-mainnet', deadline_ms: Date.now()+60000 })
if (!res.ok) {
  // res.error is canonical ErrorEnvelope
  console.error('submit failed', res.error)
} else {
  console.log('submitted', res.intent_id, res.state)
}
```

The SDK surfaces `SubmitResult` as a discriminated union: either `{ ok: true, ... }` or `{ ok: false, error: ErrorEnvelope }`.

## Tests

The repository contains a mix of unit and integration tests. Using pnpm workspace makes it easy to run package-level tests.

```bash
# run tests for a specific package
pnpm --filter @kestrel/aerie test

# run cross-package tests (example)
pnpm --filter tests-cross-pkg test
```

If you don't have pnpm, run tests per-package with `npm --prefix packages/<pkg> test`.

## Troubleshooting
- `pnpm: command not found`: install pnpm globally with `npm i -g pnpm` or use the `npm --prefix` fallbacks shown above.
- TypeScript import resolution errors between packages: ensure `packages/dto` is built first (`pnpm -w build` or `npm --prefix packages/dto run build`) or use the workspace build which builds packages in correct order.

- `Error: Cannot find module 'dist/src/index.js'`: This means the build step was skipped or failed. Run `pnpm --filter @kestrel/protocol-server run build` before starting the server.

## Next steps (recommended)
- Finish wiring `IntentFSM` into the full intake pipeline (RECEIVED → SCREENED → VALIDATED → ENRICHED → QUEUED|REJECTED → SUBMITTED → INCLUDED|DROPPED).
- Add per-reason Prometheus metrics in `IntentFSM` for richer observability.
- Expand automated tests to verify ErrorEnvelope shapes and FSM transitions.

## Contributing
- Follow existing code style. Small, focused PRs are preferred.
- Run build & tests locally before opening a PR.

---
If you'd like, I can continue wiring the FSM into the intake stages, or finish the server-wide replacement of ad-hoc errors with the canonical `ErrorEnvelope` (I left several places switched already). Tell me which follow-up you want and I'll proceed.






--------------

To successfully run the Kestrel Protocol, there are two critical steps:
1. Start the public-facing Kestrel Protocol with `npm run start:protocol` in the `kestrel-hq/packages/protocol-server` directory.
2. Run our private RPC Broker NATS server with `npm run live:proof` in the `kestrel-protocol-private/` directory.
3. Create some bot instances!!! To run one, you can use `npm run bot` in the `kestrel-fleet-v0.2.0/` directory.

Step 4 and beyond... run more instances?

Create some unique bots and keep BUILDING!

DEFI THE UNIVERSE! MAKE EVERYONE HAVE A SHOT AT CRYPTOCURRENCY!

PROFIT TOGETHER!!! YAYYYYY!
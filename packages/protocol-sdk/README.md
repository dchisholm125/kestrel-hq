# @kestrel-hq/protocol-sdk

Type-safe client for Kestrel protocol APIs with HMAC auth.

- ESM with CJS fallback via `exports`.
- Public surface defined by `src/index.ts`.# @kestrel/protocol-sdk

Tiny TypeScript SDK for the Kestrel Protocol API. Exposes a small client with HMAC signing and idempotency header wiring.

Usage:

1. Create the client:

```ts
import { ProtocolSDK } from '@kestrel/protocol-sdk';

const sdk = new ProtocolSDK({ baseUrl: 'http://localhost:8080', apiKey: 'KEY', apiSecret: 'SECRET' });

// submit
await sdk.submitIntent({ intent_id: 'foo', target_chain: 'eth-mainnet', deadline_ms: Date.now() + 60000 }, { idempotencyKey: 'uuid' });
```

Notes:
- Aerie should import this package and never use fetch directly.
- The SDK uses HMAC-SHA256 over apiKey.timestamp.body to produce `X-Kestrel-Signature`.

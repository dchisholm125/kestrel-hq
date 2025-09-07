# @kestrel-hq/aerie

On-chain scanner and arbitrage opportunity helpers.

- Depends on `@kestrel-hq/protocol-sdk`.
- Exports via barrel `src/index.ts`.
# Kestrel Aerie - OnChainScanner

This package provides the `OnChainScanner` singleton that connects to an Ethereum WebSocket endpoint and emits:

- `newBlock` (blockNumber: number)
- `pendingTransaction` (txHash: string)
- Lifecycle events: `connected`, `disconnected`, `error`, `reconnecting`, `reconnected`

## Usage
```ts
import { OnChainScanner } from 'kestrel-aerie';

await OnChainScanner.connect('ws://localhost:8545');

OnChainScanner.on('newBlock', (bn) => console.log('Block', bn));
OnChainScanner.on('pendingTransaction', (tx) => console.log('Pending', tx));
```

## Tests
Unit tests mock the `ethers` WebSocket provider. Integration tests require a local Anvil node.

Run unit tests:
```
npm test
```

Run integration test (ensure Anvil is running):
```
RUN_INTEGRATION=true npm run test:integration
```

## Start Anvil (example)
```
anvil --port 8545 --block-time 1
```

import { OnChainScanner } from '../../src/OnChainScanner';
import { WebSocketProvider, JsonRpcProvider } from 'ethers';

// Integration test requires RUN_INTEGRATION env to avoid accidental live runs
const run = process.env.RUN_INTEGRATION === 'true';
(run ? describe : describe.skip)('OnChainScanner (integration)', () => {
  const WS_URL = 'ws://127.0.0.1:8545';
  const HTTP_URL = 'http://127.0.0.1:8545';

  test('detects a mined block', async () => {
    const scanner = OnChainScanner.instance;
    const blockSpy = jest.fn();
    scanner.on('newBlock', blockSpy);

    await scanner.connect(WS_URL);

    // Wait for initial block
    const httpProvider = new JsonRpcProvider(HTTP_URL);
    const startBlock = await httpProvider.getBlockNumber();

    // Force mine a block using eth_mine (anvil auto mines on tx; we'll send a tx)
    // Simplest: send a dummy tx from default account to itself with zero value.
    const accounts = await httpProvider.send('eth_accounts', []);
    const from = accounts[0];
    await httpProvider.send('eth_sendTransaction', [{ from, to: from, value: '0x0' }]);

    // Wait up to a few seconds for new block event
    const targetBlock = startBlock + 1;
    await waitFor(() => blockSpy.mock.calls.some(c => c[0] >= targetBlock), 8000, 250);

    expect(blockSpy).toHaveBeenCalled();
    const received = Math.max(...blockSpy.mock.calls.map(c => c[0] as number));
    expect(received).toBeGreaterThanOrEqual(targetBlock);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Timeout waiting for condition');
}

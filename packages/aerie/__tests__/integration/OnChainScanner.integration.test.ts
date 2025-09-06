import { OnChainScanner } from '../../src/OnChainScanner';
import { WebSocketProvider, JsonRpcProvider } from 'ethers';

// Integration test: auto-detect local Anvil node on 127.0.0.1:8545 and run only if reachable.
describe('OnChainScanner (integration)', () => {
  console.log('[integration][OnChainScanner] Suite start');
  const WS_URL = 'ws://127.0.0.1:8546'; // Use broadcaster WebSocket
  const HTTP_URL = 'http://127.0.0.1:8545'; // Use anvil HTTP
  let reachable = false;

  // quick connectivity probe before running heavy test steps
  beforeAll(async () => {
    console.log('[integration] probing local node at 127.0.0.1:8545');
    try {
      const http = new JsonRpcProvider(HTTP_URL);
      // small timeout wrapper
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('timeout')), 2000);
      });
      const probe = http.getBlockNumber();
      await Promise.race([probe, timeout]);
      if (timer) clearTimeout(timer);
      reachable = true;
      console.log('[integration] local node reachable; proceeding with integration test');
    } catch (err) {
      reachable = false;
      console.log('[integration] local node not reachable; integration test will exit early');
    }
  });

  test('detects a mined block', async () => {
    console.log('[integration][OnChainScanner] Test start: detects a mined block');
    if (!reachable) {
      console.log('[integration] skipping test because local node is not reachable');
      return;
    }

    console.log('[integration] starting test: detects a mined block');
    const scanner = OnChainScanner.instance;
    const blockSpy = jest.fn();
    scanner.on('newBlock', blockSpy);

    console.log('[integration] connecting to', WS_URL);
    await scanner.connect(WS_URL);
    console.log('[integration] connected');

    // Wait for initial block
    const httpProvider = new JsonRpcProvider(HTTP_URL);
    const startBlock = await httpProvider.getBlockNumber();
    console.log('[integration] startBlock:', startBlock);

    // Send a dummy tx to force a new block
    const accounts = await httpProvider.send('eth_accounts', []);
    const from = accounts[0];
    console.log('[integration] sending dummy tx from', from);
    await httpProvider.send('eth_sendTransaction', [{ from, to: from, value: '0x0' }]);

    // Wait up to a few seconds for new block event
    const targetBlock = startBlock + 1;
    await waitFor(() => blockSpy.mock.calls.some(c => c[0] >= targetBlock), 8000, 250);

    console.log('[integration] blockSpy calls:', blockSpy.mock.calls.length);
    expect(blockSpy).toHaveBeenCalled();
    const received = Math.max(...blockSpy.mock.calls.map(c => c[0] as number));
    expect(received).toBeGreaterThanOrEqual(targetBlock);
    console.log('[integration] detected block', received);
  });

  afterAll(async () => {
    console.log('[integration] cleaning up scanner');
    try {
      const scanner = (await import('../../src/OnChainScanner')).OnChainScanner.instance;
      // @ts-ignore
      if ((scanner as any).destroy) await (scanner as any).destroy();
  // give the websocket a short moment to close
  await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      // ignore
    }
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

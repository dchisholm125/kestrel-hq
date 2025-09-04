import { EventEmitter } from 'events';
import { OnChainScanner } from '../../src/OnChainScanner';

console.log('[unit] OnChainScanner unit tests starting');

// Mock ethers WebSocketProvider
jest.mock('ethers', () => {
  class MockWebSocketProvider extends EventEmitter {
    url: string;
    constructor(url: string) {
      super();
      this.url = url;
    }
    async getBlockNumber() {
      return 1000; // arbitrary
    }
    removeAllListeners(eventName?: string | symbol) {
      super.removeAllListeners(eventName as any);
      return this as any;
    }
  }
  return { WebSocketProvider: MockWebSocketProvider };
});

describe('OnChainScanner (unit)', () => {
  console.log('[unit][OnChainScanner] Suite start');
  const DUMMY_URL = 'ws://dummy';

  beforeEach(async () => {
    // Reset singleton internal state by destroying (if connected)
    // (In real scenario might refactor singleton for testability.)
  });

  afterEach(async () => {
    // Ensure scanner is torn down between tests to avoid open handles
    try {
      const scanner = OnChainScanner.instance;
      // @ts-ignore
      if ((scanner as any).destroy) await (scanner as any).destroy();
  // brief pause to let sockets/timers close
  await new Promise((r) => setTimeout(r, 200));
    } catch (_) {}
  });

  test('emits newBlock when provider emits block', async () => {
    console.log('[unit][OnChainScanner] Test start: emits newBlock');
    const scanner = OnChainScanner.instance;
    const spy = jest.fn();
    scanner.on('newBlock', spy);
  console.log('[unit] connecting to', DUMMY_URL);
  await scanner.connect(DUMMY_URL);
  console.log('[unit] connected (mock)');

    // Access mocked provider to emit block
    // @ts-ignore private access for test only
  const provider = (scanner as any).provider as EventEmitter;
  const fakeBlockNumber = 12345;
  console.log('[unit] emitting fake block', fakeBlockNumber);
  provider.emit('block', fakeBlockNumber);
  console.log('[unit] spy call count:', spy.mock.calls.length);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(fakeBlockNumber);
  });

  test('emits pendingTransaction when provider emits pending', async () => {
    console.log('[unit][OnChainScanner] Test start: emits pendingTransaction');
    const scanner = OnChainScanner.instance;
    const spy = jest.fn();
    scanner.on('pendingTransaction', spy);
  console.log('[unit] connecting to', DUMMY_URL);
  await scanner.connect(DUMMY_URL);
  console.log('[unit] connected (mock)');

  // @ts-ignore private access for test only
  const provider = (scanner as any).provider as EventEmitter;
  const fakeTxHash = '0xabc123';
  console.log('[unit] emitting fake pending tx', fakeTxHash);
  provider.emit('pending', fakeTxHash);
  console.log('[unit] spy call count:', spy.mock.calls.length);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(fakeTxHash);
  });
});

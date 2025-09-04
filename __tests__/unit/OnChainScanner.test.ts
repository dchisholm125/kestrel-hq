import { EventEmitter } from 'events';
import { OnChainScanner } from '../../src/OnChainScanner';

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
  const DUMMY_URL = 'ws://dummy';

  beforeEach(async () => {
    // Reset singleton internal state by destroying (if connected)
    // (In real scenario might refactor singleton for testability.)
  });

  test('emits newBlock when provider emits block', async () => {
    const scanner = OnChainScanner.instance;
    const spy = jest.fn();
    scanner.on('newBlock', spy);
    await scanner.connect(DUMMY_URL);

    // Access mocked provider to emit block
    // @ts-ignore private access for test only
  const provider = (scanner as any).provider as EventEmitter;
    const fakeBlockNumber = 12345;
    provider.emit('block', fakeBlockNumber);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(fakeBlockNumber);
  });

  test('emits pendingTransaction when provider emits pending', async () => {
    const scanner = OnChainScanner.instance;
    const spy = jest.fn();
    scanner.on('pendingTransaction', spy);
    await scanner.connect(DUMMY_URL);

    // @ts-ignore private access for test only
  const provider = (scanner as any).provider as EventEmitter;
    const fakeTxHash = '0xabc123';
    provider.emit('pending', fakeTxHash);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(fakeTxHash);
  });
});

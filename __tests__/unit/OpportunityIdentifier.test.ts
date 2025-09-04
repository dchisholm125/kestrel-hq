import { OpportunityIdentifier, UNISWAP_V2_ROUTER_ADDRESS, WETH_ADDRESS } from '../../src/OpportunityIdentifier';
import { Interface } from 'ethers';

// Minimal ethers Provider mock interface we use
interface MockProvider {
  getTransaction: jest.Mock;
}

describe('OpportunityIdentifier (unit)', () => {
  console.log('[unit] OpportunityIdentifier unit tests starting');
  const makeProvider = (tx: any | null): MockProvider => ({
    getTransaction: jest.fn().mockResolvedValue(tx)
  });

  const iface = new Interface([
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable'
  ]);

  test('identifies a Uniswap V2 swapExactETHForTokens opportunity', async () => {
    const dummyHash = '0xhash1';

  console.log('[unit] preparing mock swapExactETHForTokens transaction for hash', dummyHash);

    const path = [WETH_ADDRESS, '0x1111111111111111111111111111111111111111'];
    const encodedData = iface.encodeFunctionData('swapExactETHForTokens', [
      0n, // amountOutMin
      path,
      '0x2222222222222222222222222222222222222222', // to
      BigInt(Math.floor(Date.now() / 1000) + 600) // deadline
    ]);

    const mockTx = {
      hash: dummyHash,
      to: UNISWAP_V2_ROUTER_ADDRESS,
      data: encodedData,
      value: 1234567890n
    };

  console.log('[unit] mock transaction prepared with path', path, 'and value', mockTx.value.toString());
    const provider = makeProvider(mockTx) as any;
    const oi = new OpportunityIdentifier(provider);

  console.log('[unit] calling analyzeTransaction for', dummyHash);
    const result = await oi.analyzeTransaction(dummyHash);
  console.log('[unit] analyzeTransaction result:', result);
    expect(result).not.toBeNull();
    expect(result?.hash).toBe(dummyHash);
    expect(result?.path).toEqual(path);
    expect(result?.amountInWei).toBe(mockTx.value);
  });

  test('returns null for non-swap transaction', async () => {
    const dummyHash = '0xhash2';
    const mockTx = {
      hash: dummyHash,
      to: '0x3333333333333333333333333333333333333333',
      value: 1n,
      data: '0x'
    };

  console.log('[unit] preparing mock non-swap transaction for hash', dummyHash);
    const provider = makeProvider(mockTx) as any;
    const oi = new OpportunityIdentifier(provider);
  console.log('[unit] calling analyzeTransaction for', dummyHash);
  const result = await oi.analyzeTransaction(dummyHash);
  console.log('[unit] analyzeTransaction result for non-swap:', result);
  expect(result).toBeNull();
  });
});

import { OpportunityIdentifier, DEX_ROUTERS, WETH_ADDRESS } from '../../src/OpportunityIdentifier';
import { Interface } from 'ethers';

// Minimal ethers Provider mock interface we use
interface MockProvider {
  getTransaction: jest.Mock;
}

describe('OpportunityIdentifier (unit)', () => {
  const makeProvider = (tx: any | null): MockProvider => ({
    getTransaction: jest.fn().mockResolvedValue(tx)
  });

  const iface = new Interface([
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable'
  ]);

  test('identifies a Uniswap V2 swapExactETHForTokens opportunity', async () => {
    const dummyHash = '0xhash1';
    const path = [WETH_ADDRESS, '0x1111111111111111111111111111111111111111'];
    const encodedData = iface.encodeFunctionData('swapExactETHForTokens', [
      0n,
      path,
      '0x2222222222222222222222222222222222222222',
      BigInt(Math.floor(Date.now() / 1000) + 600)
    ]);

    const mockTx = {
      hash: dummyHash,
      to: DEX_ROUTERS.UNISWAP_V2,
      data: encodedData,
      value: 1234567890n
    };

    const provider = makeProvider(mockTx) as any;
    const oi = new OpportunityIdentifier(provider);
    const result = await oi.analyzeTransaction(dummyHash);
    
    expect(result).not.toBeNull();
    expect(result?.hash).toBe(dummyHash);
    expect(result?.path).toEqual(path);
    expect(result?.amountInWei).toBe(mockTx.value);
    expect(result?.dex).toBe('uniswap_v2');
  });

  test('identifies a Sushiswap swapExactETHForTokens opportunity', async () => {
    const dummyHash = '0xhash_sushi';
    const path = [WETH_ADDRESS, '0x1111111111111111111111111111111111111111'];
    const encodedData = iface.encodeFunctionData('swapExactETHForTokens', [
      0n,
      path,
      '0x2222222222222222222222222222222222222222',
      BigInt(Math.floor(Date.now() / 1000) + 600)
    ]);

    const mockTx = {
      hash: dummyHash,
      to: DEX_ROUTERS.SUSHISWAP,
      data: encodedData,
      value: 1234567890n
    };

    const provider = makeProvider(mockTx) as any;
    const oi = new OpportunityIdentifier(provider);
    const result = await oi.analyzeTransaction(dummyHash);
    
    expect(result).not.toBeNull();
    expect(result?.hash).toBe(dummyHash);
    expect(result?.path).toEqual(path);
    expect(result?.amountInWei).toBe(mockTx.value);
    expect(result?.dex).toBe('sushiswap');
  });

  test('identifies a Curve V2 swapExactETHForTokens opportunity', async () => {
    const dummyHash = '0xhash_curve';
    const path = [WETH_ADDRESS, '0x1111111111111111111111111111111111111111'];
    const encodedData = iface.encodeFunctionData('swapExactETHForTokens', [
      0n,
      path,
      '0x2222222222222222222222222222222222222222',
      BigInt(Math.floor(Date.now() / 1000) + 600)
    ]);

    const mockTx = {
      hash: dummyHash,
      to: DEX_ROUTERS.CURVE_V2,
      data: encodedData,
      value: 1234567890n
    };

    const provider = makeProvider(mockTx) as any;
    const oi = new OpportunityIdentifier(provider);
    const result = await oi.analyzeTransaction(dummyHash);
    
    expect(result).not.toBeNull();
    expect(result?.hash).toBe(dummyHash);
    expect(result?.path).toEqual(path);
    expect(result?.amountInWei).toBe(mockTx.value);
    expect(result?.dex).toBe('curve_v2');
  });

  test('returns null for non-swap transaction', async () => {
    const dummyHash = '0xhash2';
    const mockTx = {
      hash: dummyHash,
      to: '0x3333333333333333333333333333333333333333',
      value: 1n,
      data: '0x'
    };

    const provider = makeProvider(mockTx) as any;
    const oi = new OpportunityIdentifier(provider);
    const result = await oi.analyzeTransaction(dummyHash);
    expect(result).toBeNull();
  });
});

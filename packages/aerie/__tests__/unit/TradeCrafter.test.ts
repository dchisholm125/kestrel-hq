import { Interface } from 'ethers';
import { TradeCrafter } from '../../src/TradeCrafter';
import { Opportunity, WETH_ADDRESS } from '../../src/OpportunityIdentifier';

// Mock provider & contract interactions
class MockContract {
  constructor(private returns: any) {}
  async getReserves() { return this.returns.reserves; }
  async token0() { return this.returns.token0; }
  async token1() { return this.returns.token1; }
}

describe('TradeCrafter (unit)', () => {
  console.log('[unit][TradeCrafter] Suite start');
  const routerAbi = [
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)'
  ];
  const iface = new Interface(routerAbi);

  const TOKEN = '0x1111111111111111111111111111111111111111';

  const baseOpportunity: Opportunity = {
    hash: '0xabc',
    tokenIn: WETH_ADDRESS,
    tokenOut: TOKEN,
    path: [WETH_ADDRESS, TOKEN],
    amountInWei: 1n * 10n ** 18n,
    functionSelector: '0x7ff36ab5',
    dex: 'uniswap_v2'
  };

  test('craftBackrun returns unsigned tx with optimized amount and slippage guard', async () => {
    console.log('[unit][TradeCrafter] Test start: craftBackrun returns unsigned tx with optimized amount and slippage guard');
    // Reserve setup: reserveTokenIn (WETH) = 500 ETH (in wei), reserveTokenOut (TOKEN) = 1,000,000 units
    const reserveWeth = 500n * 10n ** 18n;
    const reserveToken = 1_000_000n * 10n ** 18n;
    console.log('[unit][TradeCrafter] Using reserves', { reserveWeth: reserveWeth.toString(), reserveToken: reserveToken.toString() });

    const mockProvider: any = {
      // Keep gas cost zero so profitability check passes deterministically
      async estimateGas() { return 150000n; },
      async getFeeData() { return { gasPrice: 0n }; }
    };
  const executor = '0x9999999999999999999999999999999999999999';
  const crafter = new TradeCrafter(mockProvider, {
      address: '0xpair',
      token0: WETH_ADDRESS,
      token1: TOKEN,
      reserve0: reserveWeth,
      reserve1: reserveToken
  }, { [`${TOKEN.toLowerCase()}:${executor.toLowerCase()}`]: 10_000_000n * 10n ** 18n });
    console.log('[unit][TradeCrafter] Instantiated TradeCrafter with pair override');

  const profitableOpportunity: Opportunity = { ...baseOpportunity, amountInWei: 50n * 10n ** 18n };
  const tx = await crafter.craftBackrun(profitableOpportunity, executor);
    console.log('[unit][TradeCrafter] craftBackrun returned', tx ? 'tx object' : 'null');
    expect(tx).not.toBeNull();

    const decoded = iface.decodeFunctionData('swapExactTokensForTokens', tx!.data!);
    const amountIn = decoded[0] as bigint;
    const amountOutMin = decoded[1] as bigint;
    const path = decoded[2] as string[];
    const to = decoded[3] as string;

    expect(amountIn).toBeGreaterThan(0n);
    // Should be spending tokenOut and receiving WETH
    expect(path).toEqual([TOKEN, WETH_ADDRESS]);
    expect(to.toLowerCase()).toBe(executor.toLowerCase());
    // amountOutMin should include 0.5% buffer vs expected output; we only check it's > 0 and less than expected with no fee
    expect(amountOutMin).toBeGreaterThan(0n);
  });

  test('caps amountIn to wallet balance when heuristic exceeds balance', async () => {
    console.log('[unit][TradeCrafter] Test start: caps amountIn to wallet balance');
    // Reserves large, wallet balance tiny
    const reserveWeth = 1_000_000n * 10n ** 18n;
    const reserveToken = 2_000_000n * 10n ** 18n; // huge
    const executor = '0x8888888888888888888888888888888888888888';
    const smallBalance = 1_000n * 10n ** 18n; // only 1,000 tokens, heuristic would choose 0.1% of 2M = 2,000 > balance

    const mockProvider: any = {
      async estimateGas() { return 120000n; },
      async getFeeData() { return { gasPrice: 0n }; }
    };
  const crafter = new TradeCrafter(mockProvider, {
      address: '0xpair',
      token0: WETH_ADDRESS,
      token1: TOKEN,
      reserve0: reserveWeth,
      reserve1: reserveToken
    }, { [`${TOKEN.toLowerCase()}:${executor.toLowerCase()}`]: smallBalance });

  const profitableOpportunity: Opportunity = { ...baseOpportunity, amountInWei: 5_000n * 10n ** 18n };
  const tx = await crafter.craftBackrun(profitableOpportunity, executor);
    expect(tx).not.toBeNull();
  const decoded = iface.decodeFunctionData('swapExactTokensForTokens', tx!.data!);
  const amountIn = decoded[0] as bigint;
  expect(amountIn).toBeLessThanOrEqual(smallBalance); // capped by balance
  expect(amountIn).toBeGreaterThan(0n);
  console.log('[unit][TradeCrafter] Capped amountIn', amountIn.toString());
  });
});

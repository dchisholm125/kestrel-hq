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

  const opportunity: Opportunity = {
    hash: '0xabc',
    tokenIn: WETH_ADDRESS,
    tokenOut: TOKEN,
    path: [WETH_ADDRESS, TOKEN],
    amountInWei: 1000000000000000000n,
    functionSelector: '0x7ff36ab5'
  };

  test('craftBackrun returns unsigned tx with expected amountIn fraction', async () => {
    console.log('[unit][TradeCrafter] Test start: craftBackrun returns unsigned tx with expected amountIn fraction');
    // Reserve setup: reserveTokenIn (WETH) = 500 ETH (in wei), reserveTokenOut (TOKEN) = 1,000,000 units
    const reserveWeth = 500n * 10n ** 18n;
    const reserveToken = 1_000_000n * 10n ** 18n;
    console.log('[unit][TradeCrafter] Using reserves', { reserveWeth: reserveWeth.toString(), reserveToken: reserveToken.toString() });

    const mockProvider: any = {};
    const crafter = new TradeCrafter(mockProvider, {
      address: '0xpair',
      token0: WETH_ADDRESS,
      token1: TOKEN,
      reserve0: reserveWeth,
      reserve1: reserveToken
    });
    console.log('[unit][TradeCrafter] Instantiated TradeCrafter with pair override');

    const tx = await crafter.craftBackrun(opportunity);
    console.log('[unit][TradeCrafter] craftBackrun returned', tx ? 'tx object' : 'null');
    expect(tx).not.toBeNull();

    const decoded = iface.decodeFunctionData('swapExactTokensForTokens', tx!.data!);
    const amountIn = decoded[0] as bigint; // fraction of reserveTokenOut? Actually we used fraction of reserveToken (tokenOut)
    console.log('[unit][TradeCrafter] Decoded amountIn', amountIn.toString());
    const expectedFraction = (reserveToken * 10n) / 10000n; // 0.1%
    console.log('[unit][TradeCrafter] Expected fraction', expectedFraction.toString());
    expect(amountIn).toBe(expectedFraction);
    console.log('[unit][TradeCrafter] Assertion passed for amountIn fraction');
  });
});

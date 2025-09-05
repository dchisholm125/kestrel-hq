import { JsonRpcProvider, WebSocketProvider, Contract, parseEther } from 'ethers';
import { OpportunityIdentifier, WETH_ADDRESS } from '../../src/OpportunityIdentifier';
import { OnChainScanner } from '../../src/OnChainScanner';
import { TradeCrafter } from '../../src/TradeCrafter';

// Deterministic integration concept (simplified): perform a swap and then craft reverse tx.
// NOTE: Fully verifying profitability requires more complex simulation; here we assert a tx is produced.

describe('TradeCrafter (integration)', () => {
  console.log('[integration][TradeCrafter] Suite start');
  const WS_URL = 'ws://127.0.0.1:8545';
  const HTTP_URL = 'http://127.0.0.1:8545';
  const ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

  const WETH_ABI = [ 'function deposit() payable', 'function approve(address,uint256) returns (bool)' ];
  const ROUTER_ABI = [ 'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)' ];

  let reachable = false;
  let http: JsonRpcProvider;
  let ws: WebSocketProvider;
  let scanner: OnChainScanner;
  let identifier: OpportunityIdentifier;
  let crafter: TradeCrafter;

  beforeAll(async () => {
    console.log('[integration][TradeCrafter] beforeAll: probing node');
    try {
      http = new JsonRpcProvider(HTTP_URL);
      ws = new WebSocketProvider(WS_URL);
      await http.getBlockNumber();
      
      // Reset Anvil state to ensure clean nonce
      await http.send('anvil_reset', []);
      
      scanner = OnChainScanner.instance;
      identifier = new OpportunityIdentifier(ws);
      crafter = new TradeCrafter(http);
      await scanner.connect(WS_URL);
      reachable = true;
      console.log('[integration][TradeCrafter] Node reachable; setup complete');
    } catch (_) { console.log('[integration] anvil not reachable; skipping'); }
  });

  afterAll(async () => {
    try { await scanner.destroy(); } catch(_) {}
    try { (ws as any)?.destroy?.(); } catch(_) {}
  });

  test('crafts backrun transaction for a created swap', async () => {
    console.log('[integration][TradeCrafter] Test start: crafts backrun transaction for a created swap');
    if (!reachable) {
      console.log('[integration] skip - node unreachable');
      return;
    }
    const signer = await http.getSigner(0);
    console.log('[integration][TradeCrafter] Obtained signer');
    const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);
    const router = new Contract(ROUTER, ROUTER_ABI, signer);

    // Make sure to have some WETH (wrap 1 ETH)
    console.log('[integration][TradeCrafter] Depositing 1 ETH to WETH');
    const depTx = await weth.deposit({ value: parseEther('1') });
    await depTx.wait();
    console.log('[integration][TradeCrafter] Deposit mined', depTx.hash);

    // Perform swap ETH -> USDC to create opportunity
    const path = [WETH_ADDRESS, USDC];
    const deadline = Math.floor(Date.now() / 1000) + 300;
    console.log('[integration][TradeCrafter] Sending swapExactETHForTokens 0.2 ETH');
    const swapTx = await router.swapExactETHForTokens(0, path, await signer.getAddress(), deadline, { value: parseEther('0.2') });
    const hash = swapTx.hash;
    console.log('[integration][TradeCrafter] Swap pending hash', hash);

    // Wait until tx available
    let opp = null;
    for (let i = 0; i < 30; i++) {
      opp = await identifier.analyzeTransaction(hash);
      if (opp) break;
      await new Promise(r => setTimeout(r, 500));
      if (i % 5 === 0) console.log('[integration][TradeCrafter] Poll attempt', i, 'opportunity', !!opp);
    }
    expect(opp).not.toBeNull();
    console.log('[integration][TradeCrafter] Opportunity detected');

    const crafted = await crafter.craftBackrun(opp!, await signer.getAddress());
    console.log('[integration][TradeCrafter] craftBackrun result', crafted ? 'tx object' : 'null');
    expect(crafted).not.toBeNull();
  expect(((crafted!.to as string) || '').toLowerCase()).toBe('0x7a250d5630b4cf539739df2c5dacb4c659f2488d');
    expect(crafted!.data).toBeTruthy();
    console.log('[integration][TradeCrafter] Assertions passed for crafted transaction');
  }, 45000);
});

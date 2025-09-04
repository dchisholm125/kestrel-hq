import { JsonRpcProvider, WebSocketProvider, Contract, parseEther, MaxUint256 } from 'ethers';
import { OnChainScanner } from '../../src/OnChainScanner';
import { OpportunityIdentifier, WETH_ADDRESS } from '../../src/OpportunityIdentifier';

// Deterministic integration test: create a real Uniswap V2 swap (ETH -> USDC) and assert detection.
// REQUIREMENTS:
//  1. An anvil mainnet fork running at 127.0.0.1:8545 with BOTH HTTP and WS interfaces.
//     Example startup:
//       anvil --fork-url $MAINNET_RPC_URL --port 8545
//  2. Default anvil signer (index 0) funded (standard anvil behavior) with enough ETH.
// This test will:
//   - Wrap ETH to WETH (deposit)
//   - Approve Uniswap V2 Router to spend WETH (redundant for swapExactETHForTokens but kept per spec)
//   - Perform swapExactETHForTokens (ETH -> USDC) sending a small amount of ETH
//   - Listen for pending tx via OnChainScanner and verify OpportunityIdentifier classifies it.

describe('OpportunityIdentifier deterministic Uniswap V2 swap (integration)', () => {
  const WS_URL = 'ws://127.0.0.1:8545';
  const HTTP_URL = 'http://127.0.0.1:8545';
  const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

  // Minimal ABIs required for actions
  const WETH_ABI = [
    'function deposit() payable',
    'function approve(address spender, uint256 value) returns (bool)'
  ];
  const ROUTER_ABI = [
    'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)'
  ];

  let reachable = false;
  let httpProvider: JsonRpcProvider;
  let wsProvider: WebSocketProvider;
  let signer: any;
  let scanner: OnChainScanner;
  let identifier: OpportunityIdentifier;

  beforeAll(async () => {
    try {
      httpProvider = new JsonRpcProvider(HTTP_URL);
      wsProvider = new WebSocketProvider(WS_URL);
      await Promise.race([
        httpProvider.getBlockNumber(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout probing node')), 2000))
      ]);
      signer = await httpProvider.getSigner(0);
      scanner = OnChainScanner.instance;
      identifier = new OpportunityIdentifier(wsProvider); // use ws provider for mempool visibility
      await scanner.connect(WS_URL);
      reachable = true;
    } catch (err) {
      console.log('[integration] anvil fork not reachable; skipping deterministic test');
    }
  });

  afterAll(async () => {
    try { await scanner.destroy(); } catch (_) {}
    try { (wsProvider as any)?.destroy?.(); } catch (_) {}
  });

  test('detects programmatically created swapExactETHForTokens', async () => {
    if (!reachable) {
      console.log('[integration] skipped - node unreachable');
      return;
    }

    console.log('[integration] starting deterministic swap test');
    const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);
    const router = new Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, signer);

    // 1. Deposit 1 ETH -> WETH
    console.log('[integration] depositing 1 ETH to WETH');
    const depositTx = await weth.deposit({ value: parseEther('1') });
    await depositTx.wait();
    console.log('[integration] deposit mined', depositTx.hash);

    // 2. Approve router to spend WETH (not needed for swapExactETHForTokens but per spec)
    console.log('[integration] approving router for WETH');
    const approveTx = await weth.approve(UNISWAP_V2_ROUTER, MaxUint256);
    await approveTx.wait();
    console.log('[integration] approve mined', approveTx.hash);

    // Prepare to capture opportunity
  let expectedHash: string | undefined;
  const seen = new Set<string>();
  const path = [WETH_ADDRESS.toLowerCase(), USDC.toLowerCase()];
    const amountOutMin = 0; // accept any
    const to = await signer.getAddress();
    const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
    const ethToSwap = '0.1';

    const opportunityPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for opportunity')), 25000);
      scanner.on('pendingTransaction', async (hash: string) => {
        seen.add(hash);
        if (!expectedHash || hash !== expectedHash) return;
        console.log('[integration] pending event for target hash received', hash);
        for (let i = 0; i < 20; i++) {
          const opp = await identifier.analyzeTransaction(hash);
          if (opp) {
            clearTimeout(timeout);
            return resolve(opp);
          }
          await new Promise(r => setTimeout(r, 250));
        }
      });
      // Fallback polling in case event fired before expectedHash set
      const poll = async () => {
        if (expectedHash && seen.has(expectedHash)) {
          for (let i = 0; i < 20; i++) {
            const opp = await identifier.analyzeTransaction(expectedHash);
            if (opp) {
              clearTimeout(timeout);
              return resolve(opp);
            }
            await new Promise(r => setTimeout(r, 250));
          }
        }
        if (timeout.refresh) timeout.refresh();
        setTimeout(poll, 500).unref?.();
      };
      setTimeout(poll, 500).unref?.();
    });

    // 3. Execute swapExactETHForTokens (ETH -> USDC). This will emit pending hash.
    console.log('[integration] sending swapExactETHForTokens tx');
  const swapTx = await router.swapExactETHForTokens(
      amountOutMin,
      path,
      to,
      deadline,
      { value: parseEther(ethToSwap) }
    );
    expectedHash = swapTx.hash;
    console.log('[integration] swap tx sent hash', expectedHash);

    const opportunity = await opportunityPromise;
    console.log('[integration] opportunity detected', opportunity);

    expect(opportunity).toBeTruthy();
    expect(opportunity.hash).toBe(expectedHash);
    expect(opportunity.path.map((p: string) => p.toLowerCase())).toEqual(path.map(p => p.toLowerCase()));
    expect(opportunity.tokenIn.toLowerCase()).toBe(WETH_ADDRESS.toLowerCase());
    expect(opportunity.tokenOut.toLowerCase()).toBe(USDC.toLowerCase());
    // value used in tx
    expect(opportunity.amountInWei).toBe(parseEther(ethToSwap));
  });
});

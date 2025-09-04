import { KestrelSubmitter, KestrelSubmitterError } from '../../src/KestrelSubmitter';
import { JsonRpcProvider, WebSocketProvider, Contract, parseEther, MaxUint256 } from 'ethers';
import { OnChainScanner } from '../../src/OnChainScanner';
import { OpportunityIdentifier, WETH_ADDRESS } from '../../src/OpportunityIdentifier';
import { TradeCrafter } from '../../src/TradeCrafter';

// Integration tests require:
// - Local anvil fork running at 127.0.0.1:8545 (HTTP + WS)
// - Guardian API running at http://localhost:4000
describe('KestrelSubmitter (integration)', () => {
  const BASE_URL = 'http://localhost:4000';
  const submitter = new KestrelSubmitter(BASE_URL, 8000);

  const HTTP_URL = 'http://127.0.0.1:8545';
  const WS_URL = 'ws://127.0.0.1:8545';
  const ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

  const WETH_ABI = [ 'function deposit() payable', 'function approve(address,uint256) returns (bool)' ];
  const ROUTER_ABI = [ 'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)' ];

  let reachable = false;

  beforeAll(async () => {
    console.log('[integration][KestrelSubmitter] Probing Guardian API and local node');
    try {
      const res = await fetch(BASE_URL + '/health').catch(() => null);
      if (!res || !res.ok) {
        console.log('[integration][KestrelSubmitter] Guardian not reachable (health)');
        return;
      }
      // also ensure local anvil is reachable
      const http = new JsonRpcProvider(HTTP_URL);
      await http.getBlockNumber();
      reachable = true;
      console.log('[integration][KestrelSubmitter] Guardian and local node reachable; proceeding');
    } catch (err) {
      console.log('[integration][KestrelSubmitter] probe failed', err);
    }
  });

  afterAll(async () => {
    try { await OnChainScanner.instance.destroy(); } catch (_) {}
  });

  test('submits raw tx and receives accepted status', async () => {
    if (!reachable) {
      console.log('[integration][KestrelSubmitter] Skipping - prerequisites not reachable');
      return;
    }

    // Create a real swap on local anvil so TradeCrafter can craft a backrun tx
    const http = new JsonRpcProvider(HTTP_URL);
    const ws = new WebSocketProvider(WS_URL);
  const signer = await http.getSigner(0);
  try {

    const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);
    const router = new Contract(ROUTER, ROUTER_ABI, signer);

  // Ensure we have some WETH
  const dep = await weth.deposit({ value: parseEther('1') });
  await dep.wait();

  // Approve the Uniswap router to spend WETH from the signer (prevents revert on token transfers)
  console.log('[integration][KestrelSubmitter] approving router to spend WETH');
  const approveTx = await weth.approve(ROUTER, MaxUint256);
  await approveTx.wait();
  console.log('[integration][KestrelSubmitter] approve mined', approveTx.hash);

    // perform a small swap to create an opportunity
    const path = [WETH_ADDRESS, USDC];
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const swapTx = await router.swapExactETHForTokens(0, path, await signer.getAddress(), deadline, { value: parseEther('0.05') });
    const hash = swapTx.hash;

    // wait until opportunity analyzable
    const identifier = new OpportunityIdentifier(ws);
    let opp: any = null;
    for (let i = 0; i < 30; i++) {
      opp = await identifier.analyzeTransaction(hash);
      if (opp) break;
      await new Promise(r => setTimeout(r, 500));
    }
    expect(opp).not.toBeNull();

    // craft a backrun tx (unsigned)
    // Ensure signer has approved the tokenOut (USDC) to the router so the backrun can spend tokens
    const ERC20_ABI = ['function approve(address,uint256) returns (bool)'];
    try {
      const tokenContract = new Contract(USDC, ERC20_ABI, signer);
      console.log('[integration][KestrelSubmitter] approving router to spend tokenOut (USDC)');
      const approveTokenTx = await tokenContract.approve(ROUTER, MaxUint256);
      await approveTokenTx.wait();
      console.log('[integration][KestrelSubmitter] token approve mined', approveTokenTx.hash);
    } catch (err) {
      console.log('[integration][KestrelSubmitter] token approve failed', err);
    }

  const crafter = new TradeCrafter(http);
  const crafted = await crafter.craftBackrun(opp, await signer.getAddress());
    expect(crafted).not.toBeNull();

    // Sign the crafted tx using the unlocked signer (who owns the tokenOut from the swap)
    const from = await signer.getAddress();
    const chain = await http.getNetwork();
    const nonce = await http.getTransactionCount(from);
    const feeData = await http.getFeeData();
    // Use fixed hex gas values to avoid BigInt serialization issues with eth_signTransaction
    const txForSign: any = {
      from,
      to: crafted!.to,
      data: crafted!.data,
      value: '0x0',
      nonce: `0x${nonce.toString(16)}`,
      chainId: chain.chainId,
      gas: '0x7a120', // 500000
      maxFeePerGas: '0x59682f00', // 1_500_000_000 ~1.5 gwei
      maxPriorityFeePerGas: '0x59682f00'
    };

  // Ensure chainId serialized as hex string to avoid BigInt issues
  txForSign.chainId = `0x${BigInt(chain.chainId).toString(16)}`;
    // Sign using the unlocked signer via signer.signTransaction which proxies correctly to the node
    let rawTx: string;
    try {
      rawTx = await signer.signTransaction(txForSign as any);
    } catch (e) {
      throw new Error('signer.signTransaction failed: ' + String(e));
    }

    console.log('[integration][KestrelSubmitter] Submitting crafted raw tx to Guardian');
    const result = await submitter.submitTrade(rawTx);
    console.log('[integration][KestrelSubmitter] Guardian result', result);
    expect(result.status).toBe('accepted');
  } finally {
    // cleanup providers to avoid Jest open handles
    try { (ws as any)?.destroy?.(); } catch (_) {}
    try { (http as any)?.destroy?.(); } catch (_) {}
  }
  }, 60000);

  test('rejects a malformed raw transaction with a 400 error', async () => {
    if (!reachable) {
      console.log('[integration][KestrelSubmitter] Skipping malformed-tx test - prerequisites not reachable');
      return;
    }
    console.log('[integration][KestrelSubmitter] Test start: rejects malformed raw tx');
    const badRaw = '0x02f8720182010a80843b9aca0082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa8080c080a0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await expect(submitter.submitTrade(badRaw)).rejects.toThrow(KestrelSubmitterError);
    try {
      await submitter.submitTrade(badRaw);
    } catch (e: any) {
      expect(e).toBeInstanceOf(KestrelSubmitterError);
      expect(e.statusCode).toBe(400);
    }
  });
});

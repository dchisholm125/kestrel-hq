import { Interface, Provider, TransactionResponse } from 'ethers';

export interface Opportunity {
  hash: string;
  tokenIn: string;
  tokenOut: string;
  path: string[];
  amountInWei: bigint; // amount of ETH sent (for swapExactETHForTokens)
  functionSelector: string;
  dex: string; // Added to identify the DEX
}

// DEX Router Addresses (Mainnet)
export const DEX_ROUTERS = {
  UNISWAP_V2: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'.toLowerCase(),
  SUSHISWAP: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F'.toLowerCase(),
  CURVE_V2: '0x5a6A4D54456819380173272A5E8E9B9904BdF41B'.toLowerCase(), // Curve Zap for V2
} as const;

export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2'.toLowerCase();

// Function signatures and selectors
const SWAP_EXACT_ETH_FOR_TOKENS_SIGNATURE = 'swapExactETHForTokens(uint256,address[],address,uint256)';
const SWAP_EXACT_ETH_FOR_TOKENS_SELECTOR = '0x7ff36ab5'; // Uniswap V2 / Sushiswap

// Interfaces for each DEX (Uniswap and Sushiswap use the same interface)
const uniswapIface = new Interface([`function ${SWAP_EXACT_ETH_FOR_TOKENS_SIGNATURE} payable`]);
const sushiswapIface = new Interface([`function ${SWAP_EXACT_ETH_FOR_TOKENS_SIGNATURE} payable`]);
const curveIface = new Interface([`function ${SWAP_EXACT_ETH_FOR_TOKENS_SIGNATURE} payable`]); // Placeholder for Curve

export class OpportunityIdentifier {
  private provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  /**
   * Analyze a pending transaction hash for DEX swap opportunities.
   * Supports Uniswap V2, Sushiswap, and Curve V2 (MVP).
   * Returns an Opportunity object or null if not relevant / undecodable.
   */
  public async analyzeTransaction(txHash: string): Promise<Opportunity | null> {
    try {
      const tx: TransactionResponse | null = await this.provider.getTransaction(txHash);
      if (!tx) return null; // not yet available or dropped

      if (!tx.to) return null; // contract creation / unknown

      const toLower = tx.to.toLowerCase();
      let dex: string | null = null;
      let iface: Interface | null = null;

      // Check which DEX router this is
      if (toLower === DEX_ROUTERS.UNISWAP_V2) {
        dex = 'uniswap_v2';
        iface = uniswapIface;
      } else if (toLower === DEX_ROUTERS.SUSHISWAP) {
        dex = 'sushiswap';
        iface = sushiswapIface;
      } else if (toLower === DEX_ROUTERS.CURVE_V2) {
        dex = 'curve_v2';
        iface = curveIface;
      } else {
        return null; // Not a supported DEX
      }

      if (!tx.data || tx.data === '0x') return null; // no call data

      if (!tx.data.startsWith(SWAP_EXACT_ETH_FOR_TOKENS_SELECTOR)) return null; // different function

      // Decode; may throw if malformed
      const decoded = iface.decodeFunctionData(SWAP_EXACT_ETH_FOR_TOKENS_SIGNATURE, tx.data);
      // decoded: [ amountOutMin, path, to, deadline ]
      const path: string[] = (decoded[1] as string[]).map(a => a.toLowerCase());
      if (path.length < 2) return null; // need at least tokenIn->tokenOut

      const tokenIn = path[0];
      const tokenOut = path[path.length - 1];

      // Ensure tokenIn is WETH for this strategy (since swapExactETH... implies ETH input)
      if (tokenIn !== WETH_ADDRESS) {
        // Some exotic wrapper? We'll still treat it as opportunity, but can filter; choose to proceed.
      }

      const amountInWei = tx.value ?? 0n; // ETH sent with the transaction

      return {
        hash: tx.hash,
        tokenIn,
        tokenOut,
        path,
        amountInWei,
        functionSelector: SWAP_EXACT_ETH_FOR_TOKENS_SELECTOR,
        dex
      };
    } catch (err) {
      // Swallow errors for robustness, log optionally
      // console.debug('[OpportunityIdentifier] analyze error', err);
      return null;
    }
  }
}

export default OpportunityIdentifier;

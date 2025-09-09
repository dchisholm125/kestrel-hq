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

export type CandidateArb = {
  id: string;                       // hash of route + amounts + pools
  hops: Array<{
    dex: 'V2'|'V3';
    router: string;
    tokenIn: string;
    tokenOut: string;
    fee?: number;                   // V3 fee tier bps
    pool?: string;                  // for direct pool calls
  }>;
  amountIn: bigint;                 // in tokenIn units
  tokenIn: string;                  // e.g. WETH
  tokenOut: string;                 // should end == tokenIn for triangular
  chainId: number;
  source: 'mempool'|'poller'|'sim';
}

/**
 * Example CandidateArb structure:
 * {
 *   id: "a1b2c3d4e5f6",
 *   hops: [
 *     {
 *       dex: "V2",
 *       router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
 *       tokenIn: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
 *       tokenOut: "0xA0b86a33E6441e88C5F2712C3E9b74F5b6b6b6b6",
 *       fee: undefined,
 *       pool: undefined
 *     }
 *   ],
 *   amountIn: 1000000000000000000n,  // 1 ETH in wei
 *   tokenIn: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",   // WETH
 *   tokenOut: "0xA0b86a33E6441e88C5F2712C3E9b74F5b6b6b6b6", // USDC
 *   chainId: 1,
 *   source: "mempool"
 * }
 */

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
   * Convert legacy Opportunity to new CandidateArb format
   */
  private async opportunityToCandidateArb(opportunity: Opportunity, chainId: number = 1): Promise<CandidateArb> {
    // Generate ID as hash of route + amounts + pools
    const routeStr = opportunity.path.join('-');
    const idInput = `${routeStr}-${opportunity.amountInWei}-${opportunity.dex}`;
    const crypto = await import('crypto');
    const id = crypto.createHash('sha256').update(idInput).digest('hex').substring(0, 16);

    // Convert path to hops format
    const hops = opportunity.path.slice(0, -1).map((tokenIn, index) => {
      const tokenOut = opportunity.path[index + 1];
      return {
        dex: opportunity.dex.includes('v2') ? 'V2' as const : 'V3' as const,
        router: this.getRouterForDex(opportunity.dex),
        tokenIn: tokenIn.toLowerCase(),
        tokenOut: tokenOut.toLowerCase(),
        fee: opportunity.dex.includes('v3') ? 3000 : undefined, // Default 0.3% for V3
        pool: undefined // Not available in legacy format
      };
    });

    return {
      id,
      hops,
      amountIn: opportunity.amountInWei,
      tokenIn: opportunity.tokenIn.toLowerCase(),
      tokenOut: opportunity.tokenOut.toLowerCase(),
      chainId,
      source: 'mempool' as const
    };
  }

  /**
   * Get router address for a given DEX
   */
  private getRouterForDex(dex: string): string {
    switch (dex.toLowerCase()) {
      case 'uniswap_v2':
        return DEX_ROUTERS.UNISWAP_V2;
      case 'sushiswap':
        return DEX_ROUTERS.SUSHISWAP;
      case 'curve_v2':
        return DEX_ROUTERS.CURVE_V2;
      default:
        return DEX_ROUTERS.UNISWAP_V2; // fallback
    }
  }

  /**
   * Analyze a pending transaction hash for DEX swap opportunities.
   * Supports Uniswap V2, Sushiswap, and Curve V2 (MVP).
   * Returns a CandidateArb object or null if not relevant / undecodable.
   */
  public async analyzeTransaction(txHash: string): Promise<CandidateArb | null> {
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

      const legacyOpportunity = {
        hash: tx.hash,
        tokenIn,
        tokenOut,
        path,
        amountInWei,
        functionSelector: SWAP_EXACT_ETH_FOR_TOKENS_SELECTOR,
        dex
      };

      // Convert to new CandidateArb format
      return await this.opportunityToCandidateArb(legacyOpportunity, 1); // Default to mainnet
    } catch (err) {
      // Swallow errors for robustness, log optionally
      // console.debug('[OpportunityIdentifier] analyze error', err);
      return null;
    }
  }
}

export default OpportunityIdentifier;

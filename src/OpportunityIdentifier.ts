import { Interface, Provider, TransactionResponse } from 'ethers';

export interface Opportunity {
  hash: string;
  tokenIn: string;
  tokenOut: string;
  path: string[];
  amountInWei: bigint; // amount of ETH sent (for swapExactETHForTokens)
  functionSelector: string;
}

// Uniswap V2 Router02 mainnet address
export const UNISWAP_V2_ROUTER_ADDRESS = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'.toLowerCase();
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2'.toLowerCase();

// We only care (MVP) about swapExactETHForTokens
const SWAP_EXACT_ETH_FOR_TOKENS_SIGNATURE = 'swapExactETHForTokens(uint256,address[],address,uint256)';
const SWAP_EXACT_ETH_FOR_TOKENS_SELECTOR = '0x7ff36ab5'; // first 4 bytes keccak of signature

const iface = new Interface([
  `function ${SWAP_EXACT_ETH_FOR_TOKENS_SIGNATURE} payable`
]);

export class OpportunityIdentifier {
  private provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  /**
   * Analyze a pending transaction hash for a simple Uniswap V2 ETH->Token swap opportunity.
   * Returns an Opportunity object or null if not relevant / undecodable.
   */
  public async analyzeTransaction(txHash: string): Promise<Opportunity | null> {
    try {
      const tx: TransactionResponse | null = await this.provider.getTransaction(txHash);
      if (!tx) return null; // not yet available or dropped

      if (!tx.to) return null; // contract creation / unknown

      if (tx.to.toLowerCase() !== UNISWAP_V2_ROUTER_ADDRESS) return null; // not router

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
        functionSelector: SWAP_EXACT_ETH_FOR_TOKENS_SELECTOR
      };
    } catch (err) {
      // Swallow errors for robustness, log optionally
      // console.debug('[OpportunityIdentifier] analyze error', err);
      return null;
    }
  }
}

export default OpportunityIdentifier;

import { AddressLike, Contract, Interface, Provider, TransactionRequest, parseUnits, ZeroAddress } from 'ethers';
import { Opportunity, UNISWAP_V2_ROUTER_ADDRESS, WETH_ADDRESS } from './OpportunityIdentifier';

// Uniswap V2 constants
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V2_PAIR_INIT_CODE_HASH = '0x96e8ac427619fd92eb2c6f262675c0e4bcea386fe7a3b6d3c6c8f8f8f8f8f8f'; // placeholder (not used directly here)

// Minimal ABIs
const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];

const UNISWAP_V2_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)'
];

// Interface for encoding router calldata
const routerIface = new Interface(UNISWAP_V2_ROUTER_ABI);

interface PairOverride {
  address: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
}

export class TradeCrafter {
  constructor(private provider: Provider, private pairOverride?: PairOverride) {}

  /**
   * Craft a reverse (token -> WETH) swap for a detected ETH->Token opportunity.
   * Simplified heuristic:
   *  - Take a portion of tokenOut balance implied by reserves impact (placeholder: small percentage of reserveOut)
   *  - Compute expected WETH output using Uniswap V2 formula with 0.3% fee.
   *  - If output > 0, build unsigned tx calling Router.swapExactTokensForTokens.
   */
  public async craftBackrun(opportunity: Opportunity): Promise<TransactionRequest | null> {
    try {
      // Only handle simple 2-token path (WETH -> TOKEN) to reverse (TOKEN -> WETH)
      if (opportunity.path.length !== 2) return null;
      const [tokenInOriginal, tokenOutOriginal] = opportunity.path; // tokenInOriginal should be WETH, tokenOutOriginal is target token
      if (tokenInOriginal !== WETH_ADDRESS) return null; // strategy limited
      const tokenOut = tokenOutOriginal;
      const tokenIn = tokenInOriginal; // WETH

      // Derive pair address via factory call (simplify by fetching from on-chain using factory's getPair if needed)
      // We'll identify pair by searching token ordering in pair contract once fetched.
      let reserve0: bigint, reserve1: bigint, token0: string, token1: string;
      if (this.pairOverride) {
        ({ reserve0, reserve1 } = this.pairOverride);
        token0 = this.pairOverride.token0.toLowerCase();
        token1 = this.pairOverride.token1.toLowerCase();
      } else {
        const pairAddress = await this.findPairAddress(tokenIn, tokenOut);
        if (!pairAddress) return null;
        const pair = new Contract(pairAddress, UNISWAP_V2_PAIR_ABI, this.provider);
        [reserve0, reserve1] = await this.getReserves(pair);
        token0 = (await pair.token0()).toLowerCase();
        token1 = (await pair.token1()).toLowerCase();
      }

      let reserveTokenIn: bigint;
      let reserveTokenOut: bigint;
      if (token0 === tokenIn && token1 === tokenOut) {
        reserveTokenIn = reserve0;
        reserveTokenOut = reserve1;
      } else if (token0 === tokenOut && token1 === tokenIn) {
        reserveTokenIn = reserve1; // WETH reserve
        reserveTokenOut = reserve0; // token reserve
      } else {
        return null; // mismatch
      }

      // Simple heuristic for amountInBackrun (tokenOut -> tokenIn): take a small fraction of tokenOut reserve.
      // A realistic approach would replicate original swap math; for MVP we pick 0.1% of reserveTokenOut.
      const fractionBps = 10n; // 0.1% = 10 basis points
      let amountInTokenOut = (reserveTokenOut * fractionBps) / 10000n;
      if (amountInTokenOut === 0n) return null;

      // Uniswap V2 getAmountOut formula with 0.3% fee: amountOut = amountIn * 997 * reserveOut / (reserveIn*1000 + amountIn*997)
      const amountInWithFee = amountInTokenOut * 997n;
      const numerator = amountInWithFee * reserveTokenIn;
      const denominator = reserveTokenOut * 1000n + amountInWithFee;
      const amountOutExpected = numerator / denominator;
      if (amountOutExpected <= 0) return null;

      // Build calldata for swapExactTokensForTokens (TOKEN -> WETH)
      const reversePath = [tokenOut, tokenIn];
      const amountIn = amountInTokenOut;
      const amountOutMin = (amountOutExpected * 95n) / 100n; // 5% slippage buffer
      const to = await this.getRecipient();
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 5);

      const data = routerIface.encodeFunctionData('swapExactTokensForTokens', [
        amountIn,
        amountOutMin,
        reversePath,
        to,
        deadline
      ]);

      const tx: TransactionRequest = {
        to: UNISWAP_V2_ROUTER_ADDRESS,
        data,
        // gasLimit left undefined for estimation later
        // value: undefined because it's token->token
      };

      return tx;
    } catch (err) {
      // console.debug('[TradeCrafter] craftBackrun error', err);
      return null;
    }
  }

  private async getReserves(pair: Contract): Promise<[bigint, bigint]> {
    const { reserve0, reserve1 } = await pair.getReserves();
    return [BigInt(reserve0), BigInt(reserve1)];
  }

  // Simplistic: attempt to fetch pair via factory.getPair call; fallback null
  private async findPairAddress(tokenA: string, tokenB: string): Promise<string | null> {
    try {
      const factory = new Contract(UNISWAP_V2_FACTORY, ['function getPair(address,address) view returns (address)'], this.provider);
      const addr: string = await factory.getPair(tokenA, tokenB);
      if (addr && addr !== ZeroAddress) return addr;
      return null;
    } catch (_) {
      return null;
    }
  }

  private async getRecipient(): Promise<string> {
    // For MVP we direct profits to WETH holder or a fixed address; using factory address as placeholder is NOT correct
    // TODO: accept signer or recipient in constructor; for now use factory (harmless placeholder for unsigned tx)
    return UNISWAP_V2_FACTORY;
  }
}

export default TradeCrafter;

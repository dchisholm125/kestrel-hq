import { Transaction, type TransactionLike, Wallet } from 'ethers'

export type EIP1559Params = {
  chainId: bigint;
  from: string;
  to: string;
  nonce: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  value?: bigint; // default 0n
  data?: string; // 0x prefixed
};

export async function buildAndSignEip1559Tx(wallet: Wallet, p: EIP1559Params): Promise<string> {
  const tx: TransactionLike = {
    type: 2,
    chainId: p.chainId,
    to: p.to,
    nonce: Number(p.nonce),
    gasLimit: p.gasLimit,
    maxFeePerGas: p.maxFeePerGas,
    maxPriorityFeePerGas: p.maxPriorityFeePerGas,
    value: p.value ?? 0n,
    data: p.data ?? '0x'
  };
  const raw = await wallet.signTransaction(tx);
  // Validate round-trip to prevent BUFFER_OVERRUN mistakes:
  const parsed = Transaction.from(raw); // throws if malformed
  if (parsed.type !== 2) throw new Error('TxBuilder: not type-2 after sign');
  return raw;
}

export function bumpFees(maxFee: bigint, maxPrio: bigint): { maxFee: bigint; maxPrio: bigint } {
  const bump = (v: bigint) => (v * 1125n) / 1000n + 1n; // +12.5% and +1 wei
  let nextMaxFee = bump(maxFee)
  const nextMaxPrio = bump(maxPrio)
  if (nextMaxFee < nextMaxPrio) nextMaxFee = nextMaxPrio
  return { maxFee: nextMaxFee, maxPrio: nextMaxPrio };
}

export function requiredCostWei(gasLimit: bigint, maxFeePerGas: bigint, value: bigint): bigint {
  return gasLimit * maxFeePerGas + value;
}

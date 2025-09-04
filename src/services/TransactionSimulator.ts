import * as ethers from 'ethers'
import NodeConnector from './NodeConnector'
import { computeNetProfit } from '../utils/profit'

// Monitored tokens (mainnet addresses). Extend as needed.
const MONITORED_TOKENS: string[] = [
  // WETH
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase(),
  // USDC
  '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'.toLowerCase()
]

export type TokenBalanceMap = Record<string, string> // tokenAddress -> decimal string (wei units)
export type TokenDeltaMap = Record<string, string>

export type SimulationAccept = {
  decision: 'ACCEPT'
  debug: Record<string, unknown>
  balancesBefore: TokenBalanceMap
  balancesAfter: TokenBalanceMap
  deltas: TokenDeltaMap
  grossProfit: TokenDeltaMap
  grossProfitWei: string
  gasCostWei: string
  netProfitWei: string
  txHash: string
}
export type SimulationReject = {
  decision: 'REJECT'
  reason: string
  debug: Record<string, unknown>
  /** Detailed revert string or parse error message when available */
  revertMessage?: string
  grossProfitWei?: string
  gasCostWei?: string
  netProfitWei?: string
  balancesBefore?: TokenBalanceMap
  balancesAfter?: TokenBalanceMap
  deltas?: TokenDeltaMap
  grossProfit?: TokenDeltaMap
  txHash?: string
}
export type SimulationResult = SimulationAccept | SimulationReject

/**
 * TransactionSimulator
 * Basic first iteration simulator that: given a raw signed transaction (RLP / typed envelope),
 *  1. Decodes it using ethers
 *  2. Performs a provider.call (eth_call) against 'latest' with the tx fields
 *  3. Determines ACCEPT vs REJECT based on whether the call reverts
 *
 * Future extensions may include: access list building, state diffing, gas / balance checks, MEV heuristics, etc.
 */
class TransactionSimulator {
  private static instance: TransactionSimulator

  public static getInstance(): TransactionSimulator {
    if (!TransactionSimulator.instance) {
      TransactionSimulator.instance = new TransactionSimulator()
    }
    return TransactionSimulator.instance
  }

  /**
   * Analyze a raw signed transaction for basic revert / success outcome via eth_call.
   * This never mutates chain state.
   */
  public async analyze(raw: string): Promise<SimulationResult> {
    const debug: Record<string, unknown> = { steps: [] }

    const pushStep = (msg: string, extra?: Record<string, unknown>) => {
      const entry = { t: Date.now(), msg, ...(extra || {}) }
      ;(debug.steps as unknown[]).push(entry)
      // Verbose development logging
      console.debug('[TransactionSimulator]', msg, extra || '')
    }

    pushStep('start', { rawPreview: raw.slice(0, 18) })

    // Basic validation of raw hex
    if (!/^0x[0-9a-fA-F]+$/.test(raw)) {
      const msg = 'raw transaction must be 0x-prefixed hex'
      pushStep('invalid hex input', { msg })
      return { decision: 'REJECT', reason: 'invalid_raw_hex', revertMessage: msg, debug }
    }

    let parsed: ethers.TransactionLike | null = null
    let txHash: string | null = null
    try {
      // ethers v6: Transaction.from parses raw serialized tx to a Transaction object
      parsed = (ethers as any).Transaction.from(raw)
      txHash = (parsed as any).hash || null
      pushStep('parsed transaction', {
        to: (parsed as any).to,
        from: (parsed as any).from,
        nonce: (parsed as any).nonce,
        type: (parsed as any).type,
        chainId: (parsed as any).chainId,
        hash: txHash
      })
    } catch (e) {
      const parseMsg = (e as Error).message
      pushStep('parse failure', { error: parseMsg })
      return { decision: 'REJECT', reason: 'parse_error', revertMessage: parseMsg, debug }
    }

    // Acquire provider through NodeConnector (already handling reconnect logic)
    let provider: any
    try {
      provider = await NodeConnector.getInstance().getProvider()
      pushStep('got provider', { providerOk: !!provider })
    } catch (e) {
      const errMsg = (e as Error).message
      pushStep('provider acquisition failed', { error: errMsg })
      return { decision: 'REJECT', reason: 'no_provider', revertMessage: errMsg, debug }
    }

    // Build call object
    // Use hex string forms. Some fields may be undefined (e.g., contract creation)
    // gasLimit/gasPrice fields optional; provider.call ignores unknown keys
    let callObj: Record<string, unknown>
    try {
      const p: any = parsed
      // Derive 'from': ethers parser may have recovered from signature; else left undefined
      const from = p.from || (p.signature && p.signature.address) || undefined
      callObj = {
        from,
        to: p.to || undefined,
        data: p.data || '0x',
        value: p.value ? '0x' + BigInt(p.value).toString(16) : undefined,
        gas: p.gasLimit ? '0x' + BigInt(p.gasLimit).toString(16) : undefined,
        gasPrice: p.gasPrice ? '0x' + BigInt(p.gasPrice).toString(16) : undefined,
        maxFeePerGas: p.maxFeePerGas ? '0x' + BigInt(p.maxFeePerGas).toString(16) : undefined,
        maxPriorityFeePerGas: p.maxPriorityFeePerGas ? '0x' + BigInt(p.maxPriorityFeePerGas).toString(16) : undefined
      }
      pushStep('constructed call object', { callObj })
    } catch (e) {
      const errMsg = (e as Error).message
      pushStep('failed constructing call object', { error: errMsg })
      return { decision: 'REJECT', reason: 'call_obj_error', revertMessage: errMsg, debug }
    }

    // Identify from address for balance tracking
    const fromAddress: string | undefined = (callObj.from as string | undefined)?.toLowerCase()

    // Helper to build balanceOf calldata
    const buildBalanceOf = (account: string) => {
      // function balanceOf(address) => 0x70a08231 + 32-byte padded address
      const selector = '0x70a08231'
      const addr = account.replace(/^0x/, '').padStart(64, '0')
      return selector + addr
    }

    const balancesBefore: TokenBalanceMap = {}
    if (fromAddress) {
      for (const token of MONITORED_TOKENS) {
        try {
          const data = buildBalanceOf(fromAddress)
          let rawBal: string
            // prefer call; fallback to send
          if (provider && typeof provider.call === 'function') {
            rawBal = await provider.call({ to: token, data }, 'latest')
          } else {
            rawBal = await provider.send('eth_call', [{ to: token, data }, 'latest'])
          }
          const bal = BigInt(rawBal)
          balancesBefore[token] = bal.toString()
        } catch (e) {
          pushStep('balanceOf before failed', { token, error: (e as Error).message })
        }
      }
      pushStep('collected pre balances', { balancesBefore })
    }

    // Perform eth_call using provider.call or provider.send fallback
    let callSucceeded = false
    try {
      let result: unknown
      if (provider && typeof provider.call === 'function') {
        result = await provider.call(callObj, 'latest')
      } else if (provider && typeof provider.send === 'function') {
        result = await provider.send('eth_call', [callObj, 'latest'])
      } else {
        pushStep('provider lacks call/send')
    return { decision: 'REJECT', reason: 'unsupported_provider', revertMessage: 'Provider lacks call/send interface', debug, txHash: txHash || undefined }
      }
      callSucceeded = true
      pushStep('eth_call success', { returnDataPreview: String(result).slice(0, 20) })
    } catch (e) {
      // Ethers errors may embed a revert reason in different shapes; capture generously
      const errObj: Record<string, unknown> = {
        message: (e as Error).message
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyE = e as any
      if (anyE?.code) errObj.code = anyE.code
      if (anyE?.reason) errObj.reason = anyE.reason
      if (anyE?.error?.message) errObj.innerMessage = anyE.error.message
      if (anyE?.data) errObj.data = anyE.data
      const revertMessage = (anyE?.reason || anyE?.error?.message || (e as Error).message) as string
      pushStep('eth_call revert/failure', { ...errObj, revertMessage })
      return { decision: 'REJECT', reason: 'revert', revertMessage, debug, txHash: txHash || undefined }
    }

  // Heuristic post-state diff (since chain not mutated by eth_call). We attempt to infer token balance deltas.
    // Currently implemented heuristics:
    //  - WETH deposit: tx.to == WETH and data starts with 0xd0e30db0 => token increase by tx.value
    //  - WETH withdraw: tx.to == WETH and data starts with 0x2e1a7d4d => token decrease by encoded param (amount)
    // Future: integrate traces for generalized ERC20 transfer extraction.

    // Fetch post balances (real chain state unchanged by eth_call, but we support heuristic adjustments)
    const balancesAfter: TokenBalanceMap = {}
    if (fromAddress) {
      for (const token of MONITORED_TOKENS) {
        try {
          const data = buildBalanceOf(fromAddress)
          let rawBal: string
          if (provider && typeof provider.call === 'function') {
            rawBal = await provider.call({ to: token, data }, 'latest')
          } else {
            rawBal = await provider.send('eth_call', [{ to: token, data }, 'latest'])
          }
          balancesAfter[token] = BigInt(rawBal).toString()
        } catch (e) {
          pushStep('balanceOf after failed', { token, error: (e as Error).message })
        }
      }
      pushStep('collected post balances', { balancesAfter })
    }

    // Clone for possible heuristic mutation
    const adjustedAfter: Record<string, bigint> = {}
    for (const t of MONITORED_TOKENS) {
      const before = BigInt(balancesBefore[t] || '0')
      const after = BigInt(balancesAfter[t] || '0')
      adjustedAfter[t] = after
      // Heuristic adjustments
      try {
        const toAddr = (callObj.to as string | undefined)?.toLowerCase()
        const data: string = (callObj.data as string) || '0x'
        const valueHex = callObj.value as string | undefined
        const value = valueHex ? BigInt(valueHex) : 0n
        const WETH = MONITORED_TOKENS[0]
        if (t === WETH && toAddr === WETH && data.startsWith('0xd0e30db0') && value > 0n) {
          adjustedAfter[t] = before + value // simulate deposit
        }
        if (t === WETH && toAddr === WETH && data.startsWith('0x2e1a7d4d') && data.length === 10 + 64) {
          const amount = BigInt('0x' + data.slice(10))
            adjustedAfter[t] = before - amount
        }
      } catch (e) {
        pushStep('heuristic adjust failed', { token: t, error: (e as Error).message })
      }
    }

    const deltas: TokenDeltaMap = {}
    const grossProfit: TokenDeltaMap = {}
    for (const t of MONITORED_TOKENS) {
      const before = BigInt(balancesBefore[t] || '0')
      const aft = adjustedAfter[t]
      const delta = aft - before
      deltas[t] = delta.toString()
      if (delta > 0n) grossProfit[t] = delta.toString()
    }
    pushStep('computed deltas', { deltas, grossProfit })

    // Gas cost estimation (only if both limit and price-style fields present)
    let gasCostWei = 0n
    try {
      const pAny: any = parsed
      const gasLimit = pAny.gasLimit ? BigInt(pAny.gasLimit) : (callObj.gas ? BigInt(callObj.gas as string) : null)
      const gasPriceLike = pAny.gasPrice || pAny.maxFeePerGas || callObj.gasPrice || callObj.maxFeePerGas
      const gasPrice = gasPriceLike ? BigInt(gasPriceLike) : null
      if (gasLimit !== null && gasPrice !== null) {
        gasCostWei = gasLimit * gasPrice
      }
      pushStep('computed gas cost', { gasLimit: gasLimit?.toString(), gasPrice: gasPrice?.toString(), gasCostWei: gasCostWei.toString() })
    } catch (e) {
      pushStep('gas cost computation failed', { error: (e as Error).message })
    }

    // Gross profit assumption: only WETH positive delta counts for MVP
    const WETH = MONITORED_TOKENS[0]
    const grossProfitWei = (() => {
      try { return BigInt(deltas[WETH] || '0') > 0n ? BigInt(deltas[WETH]) : 0n } catch { return 0n }
    })()
    let netProfitWei = 0n
    if (grossProfitWei > 0n) {
      netProfitWei = computeNetProfit(grossProfitWei, gasCostWei)
      pushStep('profit computed', { grossProfitWei: grossProfitWei.toString(), gasCostWei: gasCostWei.toString(), netProfitWei: netProfitWei.toString() })
      if (netProfitWei <= 0n) {
  return { decision: 'REJECT', reason: 'unprofitable', revertMessage: 'Net profit less than or equal to zero after gas', debug, balancesBefore, balancesAfter, deltas, grossProfit, grossProfitWei: grossProfitWei.toString(), gasCostWei: gasCostWei.toString(), netProfitWei: netProfitWei.toString(), txHash: txHash || undefined }
      }
    } else {
      pushStep('no gross profit detected')
    }

      return { decision: 'ACCEPT', debug, balancesBefore, balancesAfter, deltas, grossProfit, grossProfitWei: grossProfitWei.toString(), gasCostWei: gasCostWei.toString(), netProfitWei: netProfitWei.toString(), txHash: txHash || 'unknown' }
  }
}

export default TransactionSimulator

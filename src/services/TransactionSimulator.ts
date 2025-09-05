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
    const debug: Record<string, unknown> = { steps: [], mode: 'trace_first' }

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

  // Build call object (common to both trace + fallback eth_call)
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

    // ---- TRACE PATH ----
    const attemptTrace = async (): Promise<SimulationResult | null> => {
      if (!provider || typeof provider.send !== 'function') return null
      if (!fromAddress) return null
      let traceResult: any
      // Try debug_traceCall first (for paid plans)
      try {
        traceResult = await provider.send('debug_traceCall', [callObj, 'latest', { tracer: 'callTracer' }])
        pushStep('debug_traceCall success')
      } catch (e1) {
        pushStep('debug_traceCall failed primary', { error: (e1 as Error).message })
        // Try debug_traceCall without tracer
        try {
          traceResult = await provider.send('debug_traceCall', [callObj, 'latest', {}])
          pushStep('debug_traceCall success (fallback no tracer)')
        } catch (e2) {
          pushStep('debug_traceCall unsupported', { error: (e2 as Error).message })
          // Try trace_call as alternative (available on more plans)
          try {
            const traceCallResult = await provider.send('trace_call', [callObj, ['trace'], 'latest'])
            traceResult = traceCallResult.trace?.[0] || traceCallResult
            pushStep('trace_call success')
          } catch (e3) {
            pushStep('trace_call failed', { error: (e3 as Error).message })
            return null
          }
        }
      }

      // If top-level trace indicates error/revert, reject
      if (traceResult?.error) {
        const revertMessage = traceResult.error
        pushStep('trace revert', { revertMessage })
        return { decision: 'REJECT', reason: 'revert', revertMessage, debug, txHash: txHash || undefined }
      }

      // Handle different trace formats
      let traceData = traceResult
      if (traceResult?.trace && Array.isArray(traceResult.trace)) {
        // trace_call format
        traceData = traceResult.trace[0] || traceResult
      }

      // If trace_call format with error in the trace item
      if (traceData?.error) {
        const revertMessage = traceData.error
        pushStep('trace revert', { revertMessage })
        return { decision: 'REJECT', reason: 'revert', revertMessage, debug, txHash: txHash || undefined }
      }

      // Aggregate token deltas from trace frames
      const tokenDeltas: Record<string, bigint> = {}
      const tokenSet = new Set<string>(MONITORED_TOKENS)
      const lowerFrom = fromAddress.toLowerCase()
      const WETH = MONITORED_TOKENS[0]

      const isAddress = (hex: string) => /^0x[0-9a-fA-F]{40}$/.test(hex)
      const sliceAddress = (wordHex: string) => '0x' + wordHex.slice(24)

      const recordDelta = (token: string, delta: bigint) => {
        token = token.toLowerCase()
        tokenSet.add(token)
        tokenDeltas[token] = (tokenDeltas[token] || 0n) + delta
      }

      type CallFrame = { from?: string; to?: string; input?: string; value?: string; calls?: CallFrame[]; action?: { from?: string; to?: string; input?: string; value?: string }; subtraces?: any[] }
      const traverse = (frame: CallFrame) => {
        if (!frame) return
        // Handle both debug_traceCall and trace_call formats
        const action = frame.action || frame
        const to = action.to?.toLowerCase()
        const from = action.from?.toLowerCase()
        const input: string = action.input || '0x'
        const value = action.value ? BigInt(action.value) : 0n
        const selector = input.slice(0, 10)
        // WETH deposit (value supplied, selector 0xd0e30db0)
        if (to === WETH && selector === '0xd0e30db0' && value > 0n && from === lowerFrom) {
          recordDelta(WETH, value)
        }
        // WETH withdraw(uint256)
        if (to === WETH && selector === '0x2e1a7d4d' && input.length >= 10 + 64 && from === lowerFrom) {
          const amount = BigInt('0x' + input.slice(10, 10 + 64))
          recordDelta(WETH, -amount)
        }
        // transfer(address,uint256)
        if (selector === '0xa9059cbb' && input.length >= 10 + 64 + 64 && to) {
          const rawToWord = input.slice(10, 10 + 64)
            const toAddr = '0x' + rawToWord.slice(24)
          const amount = BigInt('0x' + input.slice(10 + 64, 10 + 128))
          if (from === lowerFrom) recordDelta(to, -amount) // sending out tokens
          if (toAddr.toLowerCase() === lowerFrom) recordDelta(to, amount) // receiving tokens
        }
        // transferFrom(address,address,uint256)
        if (selector === '0x23b872dd' && input.length >= 10 + 64 * 3 && to) {
          const off = 10
          const fromWord = input.slice(off, off + 64)
          const toWord = input.slice(off + 64, off + 128)
          const amtWord = input.slice(off + 128, off + 192)
          const srcAddr = sliceAddress(fromWord)
          const dstAddr = sliceAddress(toWord)
          const amount = BigInt('0x' + amtWord)
          if (srcAddr.toLowerCase() === lowerFrom) recordDelta(to, -amount)
          if (dstAddr.toLowerCase() === lowerFrom) recordDelta(to, amount)
        }
        if (frame.calls) frame.calls.forEach(traverse)
        // Handle trace_call format subtraces
        if (frame.subtraces && Array.isArray(frame.subtraces)) {
          // For trace_call, we might need to reconstruct the call hierarchy
          // This is a simplified approach - in practice, you might need more complex parsing
        }
      }
      traverse(traceData)
      pushStep('parsed trace', { tokenDeltas: Object.fromEntries(Object.entries(tokenDeltas).map(([k, v]) => [k, v.toString()])) })

      // Fetch pre balances for dynamic token set
      const balancesBefore: TokenBalanceMap = {}
      const balancesAfter: TokenBalanceMap = {}
      for (const token of tokenSet) {
        try {
          const data = buildBalanceOf(lowerFrom)
          let rawBal: string
          if (provider && typeof provider.call === 'function') rawBal = await provider.call({ to: token, data }, 'latest')
          else rawBal = await provider.send('eth_call', [{ to: token, data }, 'latest'])
          const before = BigInt(rawBal)
          const delta = tokenDeltas[token] || 0n
          const after = before + delta
          balancesBefore[token] = before.toString()
          balancesAfter[token] = after.toString()
        } catch (e) {
          pushStep('balance fetch failed', { token, error: (e as Error).message })
        }
      }
      const deltas: TokenDeltaMap = {}
      const grossProfit: TokenDeltaMap = {}
      for (const [token, delta] of Object.entries(tokenDeltas)) {
        deltas[token] = delta.toString()
        if (delta > 0n) grossProfit[token] = delta.toString()
      }
      pushStep('assembled balances + deltas', { tokens: Array.from(tokenSet) })

      // Gas cost estimation (same as legacy)
      let gasCostWei = 0n
      try {
        const pAny: any = parsed
        const gasLimit = pAny.gasLimit ? BigInt(pAny.gasLimit) : (callObj.gas ? BigInt(callObj.gas as string) : null)
        const gasPriceLike = pAny.gasPrice || pAny.maxFeePerGas || callObj.gasPrice || callObj.maxFeePerGas
        const gasPrice = gasPriceLike ? BigInt(gasPriceLike) : null
        if (gasLimit !== null && gasPrice !== null) gasCostWei = gasLimit * gasPrice
        pushStep('computed gas cost', { gasCostWei: gasCostWei.toString() })
      } catch (e) {
        pushStep('gas cost computation failed', { error: (e as Error).message })
      }

      const grossProfitWei = (() => { try { return (tokenDeltas[WETH] || 0n) > 0n ? (tokenDeltas[WETH] || 0n) : 0n } catch { return 0n } })()
      let netProfitWei = 0n
      if (grossProfitWei > 0n) {
        netProfitWei = computeNetProfit(grossProfitWei, gasCostWei)
        pushStep('profit computed', { grossProfitWei: grossProfitWei.toString(), netProfitWei: netProfitWei.toString(), gasCostWei: gasCostWei.toString() })
        if (netProfitWei <= 0n) {
          return { decision: 'REJECT', reason: 'unprofitable', revertMessage: 'Net profit <= 0 after gas', debug, balancesBefore, balancesAfter, deltas, grossProfit, grossProfitWei: grossProfitWei.toString(), gasCostWei: gasCostWei.toString(), netProfitWei: netProfitWei.toString(), txHash: txHash || undefined }
        }
      } else {
        pushStep('no gross profit detected (trace)')
      }
      return { decision: 'ACCEPT', debug, balancesBefore, balancesAfter, deltas, grossProfit, grossProfitWei: grossProfitWei.toString(), gasCostWei: gasCostWei.toString(), netProfitWei: netProfitWei.toString(), txHash: txHash || 'unknown' }
    }

    const traceOutcome = await attemptTrace()
    if (traceOutcome) return traceOutcome
    // ---- FALLBACK LEGACY eth_call PATH ----
    debug.mode = 'legacy_eth_call'
    const balancesBefore: TokenBalanceMap = {}
    if (fromAddress) {
      for (const token of MONITORED_TOKENS) {
        try {
          const data = buildBalanceOf(fromAddress)
          let rawBal: string
          if (provider && typeof provider.call === 'function') rawBal = await provider.call({ to: token, data }, 'latest')
          else rawBal = await provider.send('eth_call', [{ to: token, data }, 'latest'])
          balancesBefore[token] = BigInt(rawBal).toString()
        } catch (e) {
          pushStep('balanceOf before failed', { token, error: (e as Error).message })
        }
      }
      pushStep('collected pre balances (legacy)', { balancesBefore })
    }
    let legacySucceeded = false
    try {
      if (provider && typeof provider.call === 'function') await provider.call(callObj, 'latest')
      else if (provider && typeof provider.send === 'function') await provider.send('eth_call', [callObj, 'latest'])
      else {
        pushStep('provider lacks call/send (legacy)')
        return { decision: 'REJECT', reason: 'unsupported_provider', revertMessage: 'Provider lacks call/send interface', debug, txHash: txHash || undefined }
      }
      legacySucceeded = true
      pushStep('eth_call success (legacy)')
    } catch (e) {
      const anyE: any = e
      const revertMessage = (anyE?.reason || anyE?.error?.message || (e as Error).message) as string
      pushStep('eth_call revert/failure (legacy)', { revertMessage })
      return { decision: 'REJECT', reason: 'revert', revertMessage, debug, txHash: txHash || undefined }
    }
    if (!legacySucceeded) {
      return { decision: 'REJECT', reason: 'unknown_failure', revertMessage: 'Unknown failure during legacy path', debug, txHash: txHash || undefined }
    }
    // Reuse original heuristics for WETH deposit/withdraw
    const balancesAfter: TokenBalanceMap = { ...balancesBefore }
    try {
      const toAddr = (callObj.to as string | undefined)?.toLowerCase()
      const data: string = (callObj.data as string) || '0x'
      const valueHex = callObj.value as string | undefined
      const value = valueHex ? BigInt(valueHex) : 0n
      const WETH = MONITORED_TOKENS[0]
      if (toAddr === WETH && data.startsWith('0xd0e30db0') && value > 0n) {
        const before = BigInt(balancesAfter[WETH] || '0')
        balancesAfter[WETH] = (before + value).toString()
      }
      if (toAddr === WETH && data.startsWith('0x2e1a7d4d') && data.length === 10 + 64) {
        const amount = BigInt('0x' + data.slice(10))
        const before = BigInt(balancesAfter[WETH] || '0')
        balancesAfter[WETH] = (before - amount).toString()
      }
    } catch (e) {
      pushStep('legacy heuristic adjust failed', { error: (e as Error).message })
    }
    const deltas: TokenDeltaMap = {}
    const grossProfit: TokenDeltaMap = {}
    for (const t of MONITORED_TOKENS) {
      const before = BigInt(balancesBefore[t] || '0')
      const after = BigInt(balancesAfter[t] || '0')
      const delta = after - before
      deltas[t] = delta.toString()
      if (delta > 0n) grossProfit[t] = delta.toString()
    }
    let gasCostWei = 0n
    try {
      const pAny: any = parsed
      const gasLimit = pAny.gasLimit ? BigInt(pAny.gasLimit) : (callObj.gas ? BigInt(callObj.gas as string) : null)
      const gasPriceLike = pAny.gasPrice || pAny.maxFeePerGas || callObj.gasPrice || callObj.maxFeePerGas
      const gasPrice = gasPriceLike ? BigInt(gasPriceLike) : null
      if (gasLimit !== null && gasPrice !== null) gasCostWei = gasLimit * gasPrice
      pushStep('computed gas cost (legacy)', { gasCostWei: gasCostWei.toString() })
    } catch (e) {
      pushStep('gas cost computation failed (legacy)', { error: (e as Error).message })
    }
    const WETH = MONITORED_TOKENS[0]
    const grossProfitWei = (() => { try { return BigInt(deltas[WETH] || '0') > 0n ? BigInt(deltas[WETH]) : 0n } catch { return 0n } })()
    let netProfitWei = 0n
    if (grossProfitWei > 0n) {
      netProfitWei = computeNetProfit(grossProfitWei, gasCostWei)
      if (netProfitWei <= 0n) {
        return { decision: 'REJECT', reason: 'unprofitable', revertMessage: 'Net profit <= 0 after gas (legacy)', debug, balancesBefore, balancesAfter, deltas, grossProfit, grossProfitWei: grossProfitWei.toString(), gasCostWei: gasCostWei.toString(), netProfitWei: netProfitWei.toString(), txHash: txHash || undefined }
      }
    }
    return { decision: 'ACCEPT', debug, balancesBefore, balancesAfter, deltas, grossProfit, grossProfitWei: grossProfitWei.toString(), gasCostWei: gasCostWei.toString(), netProfitWei: netProfitWei.toString(), txHash: txHash || 'unknown' }
  }
}

export default TransactionSimulator

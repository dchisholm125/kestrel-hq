import { Wallet } from 'ethers'
import axios, { AxiosInstance } from 'axios'

export interface FlashbotsBundleResponse {
  bundleHash: string
  wait(): Promise<unknown>
  status: string
  raw?: any
}

export interface FlashbotsSubmitOptions {
  targetBlockNumber: number
  maxTimestamp?: number
  revertingTxHashesAllowed?: string[]
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: any[]
}

/**
 * Minimal Flashbots client focusing on eth_sendBundle submission.
 * Docs: https://docs.flashbots.net/flashbots-protect/rpc/quick-start (adapted for relay specifics)
 */
export class FlashbotsClient {
  private relayUrl: string
  private authWallet: Wallet
  private http: AxiosInstance
  private idCounter = 1

  constructor(relayUrl: string, authWallet: Wallet) {
    this.relayUrl = relayUrl.replace(/\/$/, '')
    this.authWallet = authWallet
    this.http = axios.create({ baseURL: this.relayUrl, timeout: 10_000 })
  }

  /**
   * Submit a bundle containing a single signed raw transaction.
   * Additional txs can be supplied by extending this array.
   */
  async submitBundle(signedTransaction: string, opts: FlashbotsSubmitOptions): Promise<FlashbotsBundleResponse> {
    if (!signedTransaction || !signedTransaction.startsWith('0x')) {
      throw new Error('signedTransaction must be 0x-prefixed raw signed tx')
    }
    if (!opts || typeof opts.targetBlockNumber !== 'number') {
      throw new Error('targetBlockNumber required')
    }

    const params = [{
      txs: [signedTransaction],
      blockNumber: '0x' + opts.targetBlockNumber.toString(16),
      // Optional fields recognized by some relays
      // Using protect-style naming where relevant; real relay may differ (adjust as needed):
      // revertingTxHashes: opts.revertingTxHashesAllowed,
      // maxTimestamp: opts.maxTimestamp,
    }]

    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.idCounter++,
      method: 'eth_sendBundle',
      params,
    }

    const bodyString = JSON.stringify(body)

    // Flashbots signature: <address>:<signature>
    // Signature is wallet.signMessage(bodyString) (EIP-191 personal_sign style)
    const signature = await this.authWallet.signMessage(bodyString)
    const address = await this.authWallet.getAddress()
    const flashbotsHeader = `${address}:${signature}`

    try {
      const res = await this.http.post('', body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': flashbotsHeader,
        },
      })

      if (res.data?.error) {
        const err = new Error('Flashbots relay error: ' + res.data.error.message)
        ;(err as any).data = res.data.error
        throw err
      }

      // Typical success: { result: { bundleHash: '0x...' } }
      const bundleHash = res.data?.result?.bundleHash || res.data?.result?.bundleHash || 'unknown'

      return {
        bundleHash,
        status: 'submitted',
        raw: res.data,
        async wait() {
          // Placeholder: In full implementation, poll eth_getBundleStats or similar.
          return res.data
        },
      }
    } catch (e: any) {
      if (e.response) {
        throw new Error(`Flashbots HTTP ${e.response.status}: ${e.response.data?.error?.message || e.response.statusText}`)
      }
      throw e
    }
  }
}

export default FlashbotsClient

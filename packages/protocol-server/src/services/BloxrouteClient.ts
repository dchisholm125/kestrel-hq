import axios, { AxiosInstance } from 'axios'

/**
 * BloxrouteClient
 *
 * Purpose:
 *  - Minimal JSON-RPC client for submitting transaction bundles to a bloXroute relay
 *  - Used by the Bundle Submitter ("Megaphone") to broadcast MEV bundles to the network
 *
 * Method:
 *  - Uses JSON-RPC method `blx_submitBundle`
 *  - Minimal params required by our pipeline: `{ txs: [signedTx] }`
 *
 * Auth:
 *  - Send credentials via the HTTP Authorization header (value comes from env)
 *
 * Docs:
 *  - bloXroute BDN (EVM) docs: https://docs.bloxroute.com/bsc-and-eth/evm-blockchain-distribution-network-bdn
 *
 * Notes:
 *  - Some older references mention `blxr_submit_bundle`. This client intentionally uses
 *    `blx_submitBundle` per current docs. If bloXroute updates params (e.g., target block,
 *    timestamps, revertingTxHashes), extend the payload object accordingly.
 */
export class BloxrouteClient {
  private relayUrl: string
  private authHeader: string
  private http: AxiosInstance

  constructor(relayUrl: string, authHeader: string) {
    this.relayUrl = relayUrl.replace(/\/$/, '')
    this.authHeader = authHeader
    this.http = axios.create({
      baseURL: this.relayUrl,
      timeout: 10_000
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async submitBundle(signedTransaction: string): Promise<any> {
    if (!/^0x[0-9a-fA-F]+$/.test(signedTransaction)) {
      throw new Error('signedTransaction must be 0x-prefixed hex string')
    }

    const id = Date.now()
    const body = {
      jsonrpc: '2.0',
      id,
      method: 'blx_submitBundle',
      params: [
        {
          txs: [signedTransaction]
        }
      ]
    }

    // Observability: log submission attempt
    console.info('[BloxrouteClient] Submitting bundle...', {
      relay: this.relayUrl,
      id,
      txCount: 1
    })

    try {
      const res = await this.http.post('', body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader
        }
      })

      // JSON-RPC error response
      if (res.data?.error) {
        const err = res.data.error
        const msg = typeof err === 'string' ? err : err.message || 'Unknown bloXroute error'
        throw new Error(`bloXroute relay error: ${msg}`)
      }

      const result = res.data?.result ?? res.data
      console.info('[BloxrouteClient] ✅ Submission successful', {
        relay: this.relayUrl,
        id,
        // do not log full bundle contents; show minimal result info
        hasResult: !!result
      })
      return result
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        const status = e.response?.status
        // try common JSON-RPC error shape or raw body
        const detail =
          (e.response?.data as any)?.error?.message ||
          (e.response?.data as any)?.error ||
          (e.response?.data as any) ||
          e.message
        console.info('[BloxrouteClient] ❌ Submission failed', {
          relay: this.relayUrl,
          status,
          detail
        })
        throw new Error(`bloXroute submitBundle failed (status=${status}): ${detail}`)
      }
      console.info('[BloxrouteClient] ❌ Submission failed (non-axios error)', {
        relay: this.relayUrl,
        error: (e as Error)?.message
      })
      throw e
    }
  }
}

export default BloxrouteClient

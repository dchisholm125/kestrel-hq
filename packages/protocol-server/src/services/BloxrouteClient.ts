import axios, { AxiosInstance } from 'axios'

/**
 * BloxrouteClient
 * Minimal JSON-RPC client wrapper for submitting MEV bundles to a bloXroute relay.
 *
 * NOTE: bloXroute documentation may reference method names such as `blxr_submit_bundle`.
 * This implementation uses `blxr_submit_bundle` with params: [{ txs: [signedTx] }].
 * Adjust the method or params to match any future schema changes as needed.
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

  /** Shape of JSON-RPC success response */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async submitBundle(signedTransaction: string): Promise<any> {
    if (!/^0x[0-9a-fA-F]+$/.test(signedTransaction)) {
      throw new Error('signedTransaction must be 0x-prefixed hex string')
    }

    const id = Date.now()
    const body = {
      jsonrpc: '2.0',
      id,
      method: 'blxr_submit_bundle',
      params: [
        {
          txs: [signedTransaction]
        }
      ]
    }

    try {
      const res = await this.http.post('', body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader
        }
      })
      if (res.data?.error) {
        const err = res.data.error
        const msg = typeof err === 'string' ? err : err.message || 'Unknown bloXroute error'
        throw new Error(`bloXroute relay error: ${msg}`)
      }
      return res.data?.result ?? res.data
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const status = e.response?.status
        const detail = e.response?.data?.error || e.message
        throw new Error(`bloXroute submitBundle failed (status=${status}): ${detail}`)
      }
      throw e
    }
  }
}

export default BloxrouteClient

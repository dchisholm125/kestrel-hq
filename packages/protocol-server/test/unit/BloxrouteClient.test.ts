import BloxrouteClient from '../../src/services/BloxrouteClient'
import axios from 'axios'

describe('BloxrouteClient', () => {
  const relayUrl = 'https://api.blxrbdn.com'
  const authHeader = 'Bearer test-token'

  beforeEach(() => {
    jest.resetAllMocks()
  ;(axios as any).create = jest.fn().mockReturnValue({ post: jest.fn() })
  })

  it('submits a bundle with blx_submitBundle and Authorization header', async () => {
    const postMock = jest
      .fn()
      .mockResolvedValue({ data: { jsonrpc: '2.0', id: 123, result: { ok: true } } })
    ;(axios as any).create = jest.fn().mockReturnValue({ post: postMock })

  const client = new BloxrouteClient(relayUrl, authHeader)

    const signedTx = '0x' + 'ab'.repeat(32)
    const res = await client.submitBundle(signedTx)

    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, body, config] = postMock.mock.calls[0]

    expect(url).toBe('')

    expect(body).toMatchObject({
      jsonrpc: '2.0',
      method: 'blx_submitBundle',
      params: [
        {
          txs: [signedTx]
        }
      ]
    })

    expect(config).toBeDefined()
    expect(config.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: authHeader
    })

    expect(res).toEqual({ ok: true })
  })

  it('throws for invalid signed tx', async () => {
  const client = new BloxrouteClient(relayUrl, authHeader)
    await expect(client.submitBundle('0xzz')).rejects.toThrow('0x-prefixed hex')
  })

  it('surfaces JSON-RPC error response', async () => {
    const postMock = jest
      .fn()
      .mockResolvedValue({ data: { jsonrpc: '2.0', id: 1, error: { message: 'bad bundle' } } })
    ;(axios as any).create = jest.fn().mockReturnValue({ post: postMock })

  const client = new BloxrouteClient(relayUrl, authHeader)
    const signedTx = '0x' + 'cd'.repeat(32)
    await expect(client.submitBundle(signedTx)).rejects.toThrow(/bad bundle/)
  })

  it('wraps axios error with status and detail', async () => {
  const axiosError: any = new Error('network down')
    axiosError.isAxiosError = true
    axiosError.response = { status: 401, data: { error: 'unauthorized' } }

  const postMock = jest.fn().mockRejectedValue(axiosError)
  ;(axios as any).create = jest.fn().mockReturnValue({ post: postMock })

  const client = new BloxrouteClient(relayUrl, authHeader)
    const signedTx = '0x' + 'ef'.repeat(32)
    await expect(client.submitBundle(signedTx)).rejects.toThrow(/status=401/)
  })
})

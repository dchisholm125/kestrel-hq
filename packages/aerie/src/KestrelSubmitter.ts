import axios, { AxiosInstance } from 'axios';

export interface SubmitSuccessResponse {
  status: string; // e.g. 'accepted'
  [key: string]: any;
}

export interface SubmitErrorDetails {
  statusCode: number;
  message: string;
  data?: any;
}

export class KestrelSubmitterError extends Error {
  public readonly statusCode: number;
  public readonly data?: any;
  constructor(details: SubmitErrorDetails) {
    super(details.message);
    this.name = 'KestrelSubmitterError';
    this.statusCode = details.statusCode;
    this.data = details.data;
  }
}

export class KestrelSubmitter {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;

  constructor(baseUrl: string, defaultTimeoutMs = 5000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.defaultTimeoutMs,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Submit a raw signed transaction to the Guardian API for analysis / batching.
   * @param rawTransaction 0x-prefixed raw signed transaction bytes
   */
  async submitTrade(rawTransaction: string): Promise<SubmitSuccessResponse> {
    if (!rawTransaction || !rawTransaction.startsWith('0x')) {
      throw new KestrelSubmitterError({ statusCode: 400, message: 'rawTransaction must be a 0x-prefixed hex string' });
    }

    try {
      const res = await this.client.post('/submit-tx', { rawTransaction });
      if (res.status === 200) {
        return res.data as SubmitSuccessResponse;
      }
      throw new KestrelSubmitterError({
        statusCode: res.status,
        message: `Unexpected status code ${res.status}`,
        data: res.data
      });
    } catch (err: any) {
      if (err.response) {
        // Server responded with an error status
        throw new KestrelSubmitterError({
          statusCode: err.response.status,
          message: err.response.data?.message || `Guardian error ${err.response.status}`,
          data: err.response.data
        });
      }
      if (err.code === 'ECONNABORTED') {
        throw new KestrelSubmitterError({ statusCode: 408, message: 'Guardian request timeout' });
      }
      throw new KestrelSubmitterError({ statusCode: 500, message: err.message || 'Unknown submit error' });
    }
  }
}

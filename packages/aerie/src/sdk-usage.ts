import { ProtocolSDK } from '@kestrel-hq/protocol-sdk';

// Example wrapper showing Aerie must use the SDK for submissions.
export function createSubmitter() {
  const sdk = new ProtocolSDK({ baseUrl: 'http://localhost:8080', apiKey: 'k', apiSecret: 's' });
  return {
    submit: (intent: any, idempotencyKey?: string) => sdk.submitIntent(intent, { idempotencyKey }),
    status: (id: string) => sdk.status(id),
  };
}

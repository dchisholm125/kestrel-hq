import nock from 'nock';
import { KestrelSubmitter, KestrelSubmitterError } from '../../src/KestrelSubmitter';

// Step-by-step logging
console.log('[unit][KestrelSubmitter] Suite start');

describe('KestrelSubmitter (unit)', () => {
  const BASE_URL = 'http://localhost:3000';
  const RAW_TX = '0xdeadbeef';

  afterEach(() => {
    nock.cleanAll();
    if (!nock.isDone()) {
      console.log('[unit][KestrelSubmitter] Warning: not all nock interceptors used');
    }
  });

  test('successful submission returns response body', async () => {
    console.log('[unit][KestrelSubmitter] Test start: successful submission');
    const successBody = { status: 'accepted', txHash: '0x123' };

    nock(BASE_URL)
      .post('/submit-tx', { rawTransaction: RAW_TX })
      .reply(200, successBody);

    const submitter = new KestrelSubmitter(BASE_URL);
    const result = await submitter.submitTrade(RAW_TX);
    console.log('[unit][KestrelSubmitter] Result', result);
    expect(result).toEqual(successBody);
  });

  test('failed submission throws structured error', async () => {
    console.log('[unit][KestrelSubmitter] Test start: failed submission');
    const errorBody = { message: 'invalid tx', code: 'BAD_TX' };

    nock(BASE_URL)
      .post('/submit-tx', { rawTransaction: RAW_TX })
      .reply(400, errorBody);

    const submitter = new KestrelSubmitter(BASE_URL);
    let caught: any = null;
    try {
      await submitter.submitTrade(RAW_TX);
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KestrelSubmitterError);
    expect(caught.statusCode).toBe(400);
    expect(caught.data).toEqual(errorBody);
  });

  test('rejects non-0x rawTransaction', async () => {
    console.log('[unit][KestrelSubmitter] Test start: rejects invalid rawTransaction');
    const submitter = new KestrelSubmitter(BASE_URL);
    await expect(submitter.submitTrade('beef')).rejects.toThrow(KestrelSubmitterError);
  });
});

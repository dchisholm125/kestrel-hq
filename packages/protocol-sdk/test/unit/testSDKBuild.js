// this file is just to test that the sdk builds and can be instantiated

const { ProtocolSDK } = require('../../dist/index');
const sdk = new ProtocolSDK({ baseUrl: 'http://localhost:8080', apiKey: 'k', apiSecret: 's' });
console.log('SDK instantiated', typeof sdk.submitIntent === 'function');

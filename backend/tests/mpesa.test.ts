import { MpesaClient, MpesaConfig, PaymentCallback } from '../src/billing/mpesa';

const testConfig: MpesaConfig = {
  consumerKey: 'test-key',
  consumerSecret: 'test-secret',
  shortCode: '174379',
  passKey: 'test-passkey',
  baseUrl: 'https://sandbox.safaricom.co.ke',
};

describe('MpesaClient.generateIdempotencyKey', () => {
  it('produces a deterministic 64-char hex key', () => {
    const key1 = MpesaClient.generateIdempotencyKey('user-1', '2024-03');
    const key2 = MpesaClient.generateIdempotencyKey('user-1', '2024-03');
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64);
    expect(key1).toMatch(/^[0-9a-f]+$/);
  });

  it('produces different keys for different users or periods', () => {
    const key1 = MpesaClient.generateIdempotencyKey('user-1', '2024-03');
    const key2 = MpesaClient.generateIdempotencyKey('user-2', '2024-03');
    const key3 = MpesaClient.generateIdempotencyKey('user-1', '2024-04');
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
  });
});

describe('MpesaClient.parseCallback', () => {
  it('parses a successful callback correctly', () => {
    const callback: PaymentCallback = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-1',
          CheckoutRequestID: 'checkout-1',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 500 },
              { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
              { Name: 'TransactionDate', Value: 20191219102115 },
              { Name: 'PhoneNumber', Value: 254708374149 },
            ],
          },
        },
      },
    };

    const result = MpesaClient.parseCallback(callback);
    expect(result.success).toBe(true);
    expect(result.checkoutRequestId).toBe('checkout-1');
    expect(result.amount).toBe(500);
    expect(result.mpesaReceiptNumber).toBe('NLJ7RT61SV');
  });

  it('parses a failed callback correctly', () => {
    const callback: PaymentCallback = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-2',
          CheckoutRequestID: 'checkout-2',
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      },
    };

    const result = MpesaClient.parseCallback(callback);
    expect(result.success).toBe(false);
    expect(result.checkoutRequestId).toBe('checkout-2');
    expect(result.amount).toBeUndefined();
  });
});

describe('MpesaClient constructor', () => {
  it('creates an instance with provided config', () => {
    const client = new MpesaClient(testConfig);
    expect(client).toBeInstanceOf(MpesaClient);
  });
});

describe('MpesaClient.initiateSTKPush', () => {
  it('throws when MPESA_CALLBACK_URL is not set', async () => {
    const original = process.env.MPESA_CALLBACK_URL;
    delete process.env.MPESA_CALLBACK_URL;

    const client = new MpesaClient(testConfig);
    await expect(
      client.initiateSTKPush(
        { phoneNumber: '254712345678', amount: 500, accountReference: 'TELLY-u1', transactionDesc: 'Test' },
        'idem-key',
      ),
    ).rejects.toThrow('MPESA_CALLBACK_URL environment variable is not configured');

    process.env.MPESA_CALLBACK_URL = original;
  });
});

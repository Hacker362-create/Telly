// src/billing/mpesa.ts
// M-Pesa Daraja 2.0 integration for KES 500/month subscription billing.
// Uses Redis idempotency keys to prevent double-charges.

import axios from 'axios';
import { createHash } from 'crypto';

export interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  shortCode: string;
  passKey: string;
  baseUrl: string;
}

export interface STKPushRequest {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDesc: string;
}

export interface STKPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

export interface PaymentCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{ Name: string; Value?: string | number }>;
      };
    };
  };
}

export class MpesaClient {
  private config: MpesaConfig;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: MpesaConfig) {
    this.config = config;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    const credentials = Buffer.from(
      `${this.config.consumerKey}:${this.config.consumerSecret}`,
    ).toString('base64');

    const response = await axios.get(
      `${this.config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    this.accessToken = response.data.access_token as string;
    // Tokens expire in ~3600s; refresh 5 minutes early
    this.tokenExpiry = new Date(Date.now() + 55 * 60 * 1000);
    return this.accessToken;
  }

  private getTimestamp(): string {
    return new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);
  }

  private getPassword(timestamp: string): string {
    return Buffer.from(
      `${this.config.shortCode}${this.config.passKey}${timestamp}`,
    ).toString('base64');
  }

  /**
   * Initiate STK Push for KES 500 monthly subscription.
   * The idempotencyKey prevents duplicate charges for the same billing cycle.
   */
  async initiateSTKPush(
    request: STKPushRequest,
    idempotencyKey: string,
  ): Promise<STKPushResponse> {
    const token = await this.getAccessToken();
    const timestamp = this.getTimestamp();
    const password = this.getPassword(timestamp);

    const response = await axios.post<STKPushResponse>(
      `${this.config.baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: this.config.shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: request.amount,
        PartyA: request.phoneNumber,
        PartyB: this.config.shortCode,
        PhoneNumber: request.phoneNumber,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: request.accountReference,
        TransactionDesc: request.transactionDesc,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': idempotencyKey,
        },
      },
    );

    return response.data;
  }

  /**
   * Generate a deterministic idempotency key for a billing period.
   * Ensures the same user is never charged twice in the same month.
   */
  static generateIdempotencyKey(userId: string, billingPeriod: string): string {
    return createHash('sha256')
      .update(`${userId}:${billingPeriod}`)
      .digest('hex');
  }

  /**
   * Parse the M-Pesa callback and extract transaction details.
   */
  static parseCallback(callback: PaymentCallback): {
    checkoutRequestId: string;
    success: boolean;
    amount?: number;
    mpesaReceiptNumber?: string;
  } {
    const { stkCallback } = callback.Body;
    const success = stkCallback.ResultCode === 0;

    if (!success) {
      return { checkoutRequestId: stkCallback.CheckoutRequestID, success: false };
    }

    const items = stkCallback.CallbackMetadata?.Item ?? [];
    const amount = items.find((i) => i.Name === 'Amount')?.Value as number | undefined;
    const mpesaReceiptNumber = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value as string | undefined;

    return {
      checkoutRequestId: stkCallback.CheckoutRequestID,
      success: true,
      amount,
      mpesaReceiptNumber,
    };
  }
}

export function createMpesaClient(): MpesaClient {
  return new MpesaClient({
    consumerKey: process.env.MPESA_CONSUMER_KEY ?? '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET ?? '',
    shortCode: process.env.MPESA_SHORT_CODE ?? '',
    passKey: process.env.MPESA_PASS_KEY ?? '',
    baseUrl: process.env.MPESA_BASE_URL ?? 'https://sandbox.safaricom.co.ke',
  });
}

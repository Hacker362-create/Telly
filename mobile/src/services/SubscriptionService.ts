// mobile/src/services/SubscriptionService.ts
// Manages subscription status checks and M-Pesa payment initiation.

import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.API_URL
  ?? 'https://api.telly.co.ke';

/** Helper: build Authorization header from stored JWT token. */
async function authHeaders(): Promise<{ Authorization: string } | Record<string, never>> {
  const token = await AsyncStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

class SubscriptionService {
  async checkStatus(): Promise<boolean> {
    try {
      const userId = await AsyncStorage.getItem('userId');
      if (!userId) return false;

      const response = await fetch(`${API_URL}/subscription/status/${userId}`, {
        headers: { ...(await authHeaders()) },
      });
      const data = (await response.json()) as { isSubscribed: boolean };
      return data.isSubscribed;
    } catch {
      return false;
    }
  }

  async initiatePayment(phoneNumber: string): Promise<{ checkoutRequestId: string }> {
    const userId = await AsyncStorage.getItem('userId');
    if (!userId) {
      throw new Error('User not logged in');
    }
    const response = await fetch(`${API_URL}/subscription/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeaders()),
      },
      body: JSON.stringify({ phoneNumber }),
    });
    const data = await response.json() as { checkoutRequestId?: string; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? 'Payment initiation failed');
    }
    return data as { checkoutRequestId: string };
  }
}

export const subscriptionService = new SubscriptionService();

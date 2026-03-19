// mobile/src/services/SubscriptionService.ts
// Manages subscription status checks and M-Pesa payment initiation.

import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.API_URL ?? 'https://api.telly.co.ke';

class SubscriptionService {
  async checkStatus(): Promise<boolean> {
    try {
      const userId = await AsyncStorage.getItem('userId');
      if (!userId) return false;

      const response = await fetch(`${API_URL}/subscription/status/${userId}`);
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, phoneNumber }),
    });
    return response.json() as Promise<{ checkoutRequestId: string }>;
  }
}

export const subscriptionService = new SubscriptionService();

// mobile/src/screens/SubscriptionScreen.tsx
// M-Pesa subscription payment screen.
// Lets users enter their Safaricom phone number and triggers an STK push
// (the M-Pesa pop-up on their phone) for KES 500/month.
// Polls the subscription status every 5 seconds after payment initiation
// to detect when the payment completes.

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { subscriptionService } from '../services/SubscriptionService';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Subscription'>;
};

type PaymentState = 'idle' | 'sending' | 'polling' | 'success' | 'error';

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 24; // 2 minutes total

export default function SubscriptionScreen({ navigation }: Props): React.JSX.Element {
  const [phone, setPhone] = useState('+254');
  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);
  const pollCount = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = (): void => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => stopPolling();
  }, []);

  const startPolling = (): void => {
    pollCount.current = 0;
    pollTimer.current = setInterval(async () => {
      pollCount.current += 1;

      if (pollCount.current > MAX_POLLS) {
        stopPolling();
        setPaymentState('error');
        Alert.alert(
          'Payment Timeout',
          'We didn\'t receive payment confirmation. Please try again or contact support.',
        );
        return;
      }

      const isActive = await subscriptionService.checkStatus();
      if (isActive) {
        stopPolling();
        setPaymentState('success');
      }
    }, POLL_INTERVAL_MS);
  };

  const handlePay = async (): Promise<void> => {
    const trimmed = phone.trim();
    if (!/^\+254\d{9}$/.test(trimmed)) {
      Alert.alert('Invalid Number', 'Enter a valid Safaricom number, e.g. +254712345678');
      return;
    }

    setPaymentState('sending');
    try {
      const result = await subscriptionService.initiatePayment(trimmed);
      setCheckoutRequestId(result.checkoutRequestId);
      setPaymentState('polling');
      startPolling();
    } catch {
      setPaymentState('error');
      Alert.alert(
        'Payment Failed',
        'Could not initiate payment. Please check your connection and try again.',
      );
    }
  };

  if (paymentState === 'success') {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.successIcon}>🎉</Text>
        <Text style={styles.successTitle}>You're subscribed!</Text>
        <Text style={styles.successSubtitle}>
          Telly is now active for 30 days. Enjoy ultra-low data calls.
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.replace('Home')}
        >
          <Text style={styles.buttonText}>Start Calling</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.center}>
        <Text style={styles.planIcon}>📱</Text>
        <Text style={styles.planTitle}>Telly — KES 500 / month</Text>
        <Text style={styles.planFeatures}>
          ✓ Unlimited VoIP calls{'\n'}
          ✓ Uses only ~1 MB per minute{'\n'}
          ✓ Works on 2G / edge networks{'\n'}
          ✓ Swahili/English AI assistant
        </Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Safaricom Phone Number</Text>
        <TextInput
          style={styles.input}
          placeholder="+254712345678"
          placeholderTextColor="#9E9E9E"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          editable={paymentState === 'idle' || paymentState === 'error'}
        />

        {paymentState === 'polling' && (
          <View style={styles.pollingBox}>
            <ActivityIndicator color="#1976D2" style={{ marginRight: 10 }} />
            <Text style={styles.pollingText}>
              Check your phone for the M-Pesa PIN prompt…
            </Text>
          </View>
        )}

        {checkoutRequestId && paymentState === 'polling' && (
          <Text style={styles.refText}>Ref: {checkoutRequestId}</Text>
        )}

        <TouchableOpacity
          style={[
            styles.button,
            (paymentState === 'sending' || paymentState === 'polling') && styles.buttonDisabled,
          ]}
          onPress={handlePay}
          disabled={paymentState === 'sending' || paymentState === 'polling'}
        >
          {paymentState === 'sending' ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.buttonText}>
              {paymentState === 'polling' ? 'Waiting for payment…' : 'Pay KES 500 via M-Pesa'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => {
            stopPolling();
            navigation.goBack();
          }}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 24 },
  center: { alignItems: 'center', marginBottom: 24 },
  planIcon: { fontSize: 52, marginTop: 20 },
  planTitle: { fontSize: 20, fontWeight: '700', color: '#1A237E', marginTop: 12, marginBottom: 12 },
  planFeatures: {
    color: '#424242',
    fontSize: 14,
    lineHeight: 24,
    textAlign: 'center',
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 12,
  },
  form: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    elevation: 2,
  },
  label: { color: '#424242', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#212121',
    backgroundColor: '#FAFAFA',
    marginBottom: 8,
  },
  pollingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  pollingText: { color: '#1565C0', fontSize: 13, flex: 1 },
  refText: { color: '#9E9E9E', fontSize: 11, marginBottom: 8 },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  cancelButton: { alignItems: 'center', marginTop: 14 },
  cancelText: { color: '#757575', fontSize: 14 },
  successIcon: { fontSize: 72 },
  successTitle: { fontSize: 26, fontWeight: '700', color: '#2E7D32', marginTop: 16 },
  successSubtitle: { color: '#424242', fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 32 },
});

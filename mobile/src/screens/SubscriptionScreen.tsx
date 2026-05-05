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
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { subscriptionService } from '../services/SubscriptionService';
import { theme } from '../theme';
import AppCard from '../components/AppCard';
import AppButton from '../components/AppButton';
import AppInput from '../components/AppInput';
import FadeInView from '../components/FadeInView';

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
      <FadeInView style={[styles.container, styles.center]}>
        <Text style={styles.successIcon}>🎉</Text>
        <Text style={styles.successTitle}>You're subscribed!</Text>
        <Text style={styles.successSubtitle}>
          Telly is now active for 30 days. Enjoy ultra-low data calls.
        </Text>
        <AppButton
          label="Start Calling"
          onPress={() => navigation.replace('Home')}
          variant="success"
          style={styles.successButton}
        />
      </FadeInView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.bgOrbTop} />
      <View style={styles.bgOrbBottom} />
      <FadeInView style={styles.center}>
        <Text style={styles.planIcon}>📱</Text>
        <Text style={styles.planTitle}>Telly — KES 100 / month</Text>
        <Text style={styles.planFeatures}>
          ✓ Unlimited VoIP calls{'\n'}
          ✓ Uses only ~1 MB per minute{'\n'}
          ✓ Works on 2G / edge networks{'\n'}
          ✓ Swahili/English AI assistant
        </Text>
        <Text style={styles.freeTierNote}>
          🆓 Free tier: 10 minutes/day — no payment needed
        </Text>
      </FadeInView>

      <FadeInView delay={90}>
      <AppCard>
        <AppInput
          label="Safaricom Phone Number"
          placeholder="+254712345678"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          editable={paymentState === 'idle' || paymentState === 'error'}
        />

        {paymentState === 'polling' && (
          <View style={styles.pollingBox}>
            <ActivityIndicator color={theme.colors.accent} style={{ marginRight: 10 }} />
            <Text style={styles.pollingText}>
              Check your phone for the M-Pesa PIN prompt…
            </Text>
          </View>
        )}

        {checkoutRequestId && paymentState === 'polling' && (
          <Text style={styles.refText}>Ref: {checkoutRequestId}</Text>
        )}

        <AppButton
          style={styles.buttonSpacing}
          label={paymentState === 'polling' ? 'Waiting for payment...' : 'Pay KES 100 via M-Pesa'}
          onPress={handlePay}
          loading={paymentState === 'sending'}
          disabled={paymentState === 'sending' || paymentState === 'polling'}
          variant="success"
        />

        <AppButton
          style={styles.cancelButton}
          label="Cancel"
          variant="ghost"
          onPress={() => {
            stopPolling();
            navigation.goBack();
          }}
        />
      </AppCard>
      </FadeInView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: 24 },
  bgOrbTop: {
    position: 'absolute',
    top: -90,
    left: -80,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(82, 212, 240, 0.15)',
  },
  bgOrbBottom: {
    position: 'absolute',
    bottom: -130,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(43, 208, 168, 0.1)',
  },
  center: { alignItems: 'center', marginBottom: 24 },
  planIcon: { fontSize: 52, marginTop: 20 },
  planTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.text, marginTop: 12, marginBottom: 12 },
  planFeatures: {
    color: theme.colors.text,
    fontSize: 14,
    lineHeight: 24,
    textAlign: 'center',
    backgroundColor: 'rgba(82, 212, 240, 0.12)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(82, 212, 240, 0.3)',
  },
  freeTierNote: {
    color: theme.colors.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    fontWeight: '600',
  },
  pollingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(82, 212, 240, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(82, 212, 240, 0.25)',
  },
  pollingText: { color: theme.colors.text, fontSize: 13, flex: 1 },
  refText: { color: theme.colors.muted, fontSize: 11, marginBottom: 8 },
  buttonSpacing: {
    marginTop: 8,
  },
  cancelButton: { marginTop: 12 },
  successIcon: { fontSize: 72 },
  successTitle: { fontSize: 26, fontWeight: '800', color: theme.colors.success, marginTop: 16 },
  successSubtitle: { color: theme.colors.text, fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 32 },
  successButton: { width: '100%' },
});

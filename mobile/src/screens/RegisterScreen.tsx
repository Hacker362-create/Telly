// mobile/src/screens/RegisterScreen.tsx
// New user registration screen.
// Collects name, email, phone number, and password; on success logs the user in
// and navigates to Home.

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { theme } from '../theme';
import { signalingService } from '../services/SignalingService';
import AppCard from '../components/AppCard';
import AppInput from '../components/AppInput';
import AppButton from '../components/AppButton';
import FadeInView from '../components/FadeInView';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Register'>;
};

const API_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.API_URL
  ?? 'https://api.telly.co.ke';

export default function RegisterScreen({ navigation }: Props): React.JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+254');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async (): Promise<void> => {
    if (!name.trim() || !email.trim() || !phone.trim() || !password) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }

    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          phoneNumber: phone.trim(),
        }),
      });

      const data = await response.json() as {
        user?: { id: string; name: string; email: string; phoneNumber: string };
        token?: string;
        tellyId?: string | null;
        error?: string;
      };

      if (!response.ok) {
        Alert.alert('Registration Failed', data.error ?? 'Please check your details and try again.');
        return;
      }

      if (data.token && data.user) {
        let resolvedTellyId = data.tellyId ?? null;

        // Fallback: fetch generated Telly ID if register response omitted it.
        if (!resolvedTellyId) {
          try {
            const tidRes = await fetch(`${API_URL}/telly-id`, {
              headers: { Authorization: `Bearer ${data.token}` },
            });
            if (tidRes.ok) {
              const tidPayload = await tidRes.json() as { tellyId?: string };
              resolvedTellyId = tidPayload.tellyId ?? null;
            }
          } catch {
            // Ignore fallback errors; signup already succeeded.
          }
        }

        await AsyncStorage.multiSet([
          ['authToken', data.token],
          ['userId', data.user.id],
          ['userName', data.user.name],
          ['userPhone', data.user.phoneNumber],
          ['tellyId', resolvedTellyId ?? ''],
        ]);

        signalingService.connect(data.user.id, data.token);

        if (resolvedTellyId) {
          Alert.alert('Account ready', `Your Telly ID is ${resolvedTellyId}`);
        }

        navigation.replace('Home');
      }
    } catch {
      Alert.alert('Error', 'Could not connect to the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.bgOrbTop} />
        <View style={styles.bgOrbBottom} />
        <FadeInView style={styles.header}>
          <Text style={styles.logoText}>📞</Text>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Set up your profile to start low-data calls.</Text>
        </FadeInView>

        <FadeInView delay={90}>
          <AppCard>
          <AppInput
            label="Full Name"
            placeholder="e.g. Alice Kamau"
            autoCapitalize="words"
            value={name}
            onChangeText={setName}
          />

          <AppInput
            label="Email"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={setEmail}
          />

          <AppInput
            label="Phone Number (E.164)"
            placeholder="+254712345678"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />

          <AppInput
            label="Password"
            placeholder="Minimum 8 characters"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <AppButton
            style={styles.buttonSpacing}
            label="Create Account"
            onPress={handleRegister}
            loading={loading}
          />

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkHighlight}>Sign In</Text>
            </Text>
          </TouchableOpacity>
          </AppCard>
        </FadeInView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: 24, justifyContent: 'center', flexGrow: 1 },
  bgOrbTop: {
    position: 'absolute',
    top: -80,
    right: -40,
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: 'rgba(82, 212, 240, 0.15)',
  },
  bgOrbBottom: {
    position: 'absolute',
    bottom: -120,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(43, 208, 168, 0.12)',
  },
  header: { alignItems: 'center', marginBottom: 28 },
  logoText: { fontSize: 48 },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '800', marginTop: 8 },
  subtitle: { color: theme.colors.muted, fontSize: 13, marginTop: 6 },
  buttonSpacing: {
    marginTop: 20,
  },
  linkButton: { alignItems: 'center', marginTop: 16 },
  linkText: { color: theme.colors.muted, fontSize: 14 },
  linkHighlight: { color: theme.colors.accent, fontWeight: '700' },
});

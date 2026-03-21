// mobile/src/screens/LoginScreen.tsx
// Email/password login screen.
// On success stores the JWT token and userId in AsyncStorage and navigates to Home.

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
import AppCard from '../components/AppCard';
import AppInput from '../components/AppInput';
import AppButton from '../components/AppButton';
import FadeInView from '../components/FadeInView';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

const API_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.API_URL
  ?? 'https://api.telly.co.ke';

export default function LoginScreen({ navigation }: Props): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (): Promise<void> => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await response.json() as {
        user?: { id: string; name: string; email: string; phoneNumber: string };
        token?: string;
        tellyId?: string | null;
        error?: string;
      };

      if (!response.ok) {
        Alert.alert('Login Failed', data.error ?? 'Invalid credentials');
        return;
      }

      if (data.token && data.user) {
        let resolvedTellyId = data.tellyId ?? null;
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
            // Keep login successful even if profile enrichment fails.
          }
        }

        await AsyncStorage.multiSet([
          ['authToken', data.token],
          ['userId', data.user.id],
          ['userName', data.user.name],
          ['userPhone', data.user.phoneNumber],
          ['tellyId', resolvedTellyId ?? ''],
        ]);
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

        <FadeInView style={styles.logoContainer}>
          <Text style={styles.logoText}>📞</Text>
          <Text style={styles.appName}>Telly</Text>
          <Text style={styles.tagline}>Ultra-low data VoIP, built for every network.</Text>
        </FadeInView>

        <FadeInView delay={90}>
          <AppCard style={styles.form}>
          <Text style={styles.formTitle}>Welcome Back</Text>
          <Text style={styles.formSubtitle}>Sign in to continue to your calling workspace.</Text>

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
            label="Password"
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <AppButton
            style={styles.buttonSpacing}
            label="Sign In"
            onPress={handleLogin}
            loading={loading}
          />

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={styles.linkText}>
              Don't have an account? <Text style={styles.linkHighlight}>Register</Text>
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
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  bgOrbTop: {
    position: 'absolute',
    top: -90,
    left: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(82, 212, 240, 0.18)',
  },
  bgOrbBottom: {
    position: 'absolute',
    bottom: -120,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(43, 208, 168, 0.14)',
  },
  logoContainer: { alignItems: 'center', marginBottom: 36 },
  logoText: { fontSize: 56 },
  appName: { color: theme.colors.text, fontSize: 36, fontWeight: '800', marginTop: 8 },
  tagline: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  form: { },
  formTitle: { color: theme.colors.text, fontSize: 24, fontWeight: '800' },
  formSubtitle: { color: theme.colors.muted, fontSize: 13, marginTop: 4, marginBottom: 12 },
  buttonSpacing: {
    marginTop: 20,
  },
  linkButton: { alignItems: 'center', marginTop: 16 },
  linkText: { color: theme.colors.muted, fontSize: 14 },
  linkHighlight: { color: theme.colors.accent, fontWeight: '700' },
});

import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppCard from '../components/AppCard';
import AppInput from '../components/AppInput';
import AppButton from '../components/AppButton';
import FadeInView from '../components/FadeInView';
import { theme } from '../theme';
import { getOrCreateDeviceId } from '../services/DeviceService';
import appPackage from '../../package.json';

const API_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.API_URL
  ?? 'https://api.telly.co.ke';

export default function ReportIssueScreen(): React.JSX.Element {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    if (!message.trim()) {
      Alert.alert('Missing details', 'Please describe the issue you experienced.');
      return;
    }
    setSending(true);
    try {
      const token = await AsyncStorage.getItem('authToken');
      if (!token) {
        Alert.alert('Not signed in', 'Please sign in again to send feedback.');
        return;
      }
      const deviceId = await getOrCreateDeviceId();
      const logs = {
        deviceId,
        platform: Platform.OS,
        platformVersion: String(Platform.Version),
      };
      const res = await fetch(`${API_URL}/feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message.trim(),
          logs,
          platform: Platform.OS,
          appVersion: appPackage.version,
        }),
      });
      if (!res.ok) {
        throw new Error('Feedback failed');
      }
      Alert.alert('Thank you', 'Your report has been sent.');
      setMessage('');
    } catch {
      Alert.alert('Send failed', 'Could not send your report. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <FadeInView>
        <AppCard style={styles.card}>
          <Text style={styles.title}>Report an Issue</Text>
          <Text style={styles.subtitle}>Help us improve by sharing what went wrong.</Text>
          <AppInput
            label="What happened?"
            value={message}
            onChangeText={setMessage}
            placeholder="Describe the call issue, audio problem, or bug"
            multiline
          />
          <AppButton
            label={sending ? 'Sending...' : 'Send report'}
            onPress={handleSubmit}
            loading={sending}
            style={styles.button}
          />
        </AppCard>
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: 20 },
  card: { padding: 16 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, marginTop: 6, fontSize: 12 },
  button: { marginTop: 16 },
});

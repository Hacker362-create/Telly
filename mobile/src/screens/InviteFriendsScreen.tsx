import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Share, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import { theme } from '../theme';
import AppCard from '../components/AppCard';
import AppButton from '../components/AppButton';
import FadeInView from '../components/FadeInView';

const API_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.API_URL
  ?? 'https://api.telly.co.ke';

type ReferralStats = {
  referralCode: string;
  referralCount: number;
  referralRewardsEarned: number;
  bonusMinutes: number;
};

export default function InviteFriendsScreen(): React.JSX.Element {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const token = await AsyncStorage.getItem('authToken');
        const res = await fetch(`${API_URL}/referral/me`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          throw new Error('Failed to fetch referral data');
        }
        const payload = await res.json() as ReferralStats;
        setStats(payload);
      } catch {
        Alert.alert('Referral unavailable', 'Could not load your referral details.');
      } finally {
        setLoading(false);
      }
    };
    load().catch(() => undefined);
  }, []);

  const handleShare = async (): Promise<void> => {
    if (!stats?.referralCode) return;
    try {
      await Share.share({
        message: `Join me on Telly and get free calling minutes! Use my code: ${stats.referralCode}`,
      });
    } catch {
      Alert.alert('Share failed', 'Could not open the share dialog.');
    }
  };

  const handleCopy = (): void => {
    if (!stats?.referralCode) return;
    Clipboard.setString(stats.referralCode);
    Alert.alert('Copied', 'Your referral code has been copied.');
  };

  return (
    <View style={styles.container}>
      <FadeInView>
        <AppCard style={styles.card}>
          <Text style={styles.title}>Invite Friends</Text>
          <Text style={styles.subtitle}>
            Share your code and both of you get bonus calling minutes.
          </Text>
          <Text style={styles.codeLabel}>Your referral code</Text>
          <Text style={styles.code}>{stats?.referralCode ?? (loading ? 'Loading...' : '--')}</Text>
          <View style={styles.actions}>
            <AppButton label="Copy" onPress={handleCopy} style={styles.actionBtn} />
            <AppButton label="Share" variant="ghost" onPress={handleShare} style={styles.actionBtn} />
          </View>
        </AppCard>
      </FadeInView>

      {stats && (
        <FadeInView delay={80}>
          <AppCard style={styles.statsCard}>
            <Text style={styles.statsTitle}>Your rewards</Text>
            <Text style={styles.statsRow}>Invites: {stats.referralCount}</Text>
            <Text style={styles.statsRow}>Bonus minutes earned: {stats.referralRewardsEarned}</Text>
            <Text style={styles.statsRow}>Bonus minutes available: {stats.bonusMinutes}</Text>
          </AppCard>
        </FadeInView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: 20, gap: 12 },
  card: { padding: 16 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, marginTop: 6, fontSize: 12 },
  codeLabel: { color: theme.colors.muted, marginTop: 16, fontSize: 11, textTransform: 'uppercase' },
  code: { color: theme.colors.accent, fontSize: 28, fontWeight: '800', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionBtn: { flex: 1 },
  statsCard: { padding: 16 },
  statsTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  statsRow: { color: theme.colors.muted, marginTop: 6, fontSize: 12 },
});

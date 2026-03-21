// mobile/src/screens/HomeScreen.tsx
// Home screen showing contacts and subscription status.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { signalingService } from '../services/SignalingService';
import { subscriptionService } from '../services/SubscriptionService';
import { theme } from '../theme';
import AppCard from '../components/AppCard';
import FadeInView from '../components/FadeInView';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

const API_URL =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_URL
  ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.API_URL
  ?? 'https://api.telly.co.ke';

const DEMO_CONTACTS = [
  { id: 'user-demo-1', name: 'Alice Kamau', phone: '+254711000001' },
  { id: 'user-demo-2', name: 'Bob Otieno', phone: '+254722000002' },
  { id: 'user-demo-3', name: 'Carol Njeri', phone: '+254733000003' },
];

export default function HomeScreen({ navigation }: Props): React.JSX.Element {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [userName, setUserName] = useState('');
  const [tellyId, setTellyId] = useState('');
  const [successRate, setSuccessRate] = useState<number | null>(null);

  useEffect(() => {
    subscriptionService.checkStatus().then(setIsSubscribed);
    AsyncStorage.getItem('userName').then((n) => setUserName(n ?? ''));
    AsyncStorage.getItem('tellyId').then(async (v) => {
      const stored = v ?? '';
      setTellyId(stored);
      if (stored) return;

      const token = await AsyncStorage.getItem('authToken');
      if (!token) return;

      try {
        const res = await fetch(`${API_URL}/telly-id`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const payload = await res.json() as { tellyId?: string };
        if (payload.tellyId) {
          setTellyId(payload.tellyId);
          await AsyncStorage.setItem('tellyId', payload.tellyId);
        }
      } catch {
        // Non-fatal: the screen works without this enrichment.
      }
    });
    fetch(`${API_URL}/metrics/success-rate`)
      .then((r) => r.json())
      .then((d: { successRate?: number }) => {
        if (typeof d.successRate === 'number') setSuccessRate(d.successRate);
      })
      .catch(() => undefined);

    signalingService.onIncomingCall((callId, callerId) => {
      navigation.navigate('IncomingCall', { callId, callerId });
    });

    signalingService.onSubscriptionGrace((message) => {
      Alert.alert('Subscription grace period', message);
    });
  }, [navigation]);

  const handleCall = (contactId: string): void => {
    if (!isSubscribed) {
      Alert.alert(
        'No Active Subscription',
        'Subscribe for KES 500/month to make calls.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Subscribe', onPress: () => navigation.navigate('Subscription') },
        ],
      );
      return;
    }
    signalingService.warmupCall(contactId);
    const callId = signalingService.initiateCall(contactId);
    navigation.navigate('Call', { callId, remoteUserId: contactId, incoming: false });
  };

  const handleLogout = async (): Promise<void> => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          signalingService.disconnect();
          await AsyncStorage.multiRemove(['authToken', 'userId', 'userName', 'userPhone', 'tellyId']);
          navigation.replace('Login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.bgOrbTop} />
      <View style={styles.bgOrbBottom} />

      {/* Top bar with greeting and logout */}
      <FadeInView style={styles.topBar}>
        <View style={styles.topLeft}>
          <Text style={styles.kicker}>Dashboard</Text>
          <Text style={styles.greeting} numberOfLines={1}>
            {userName ? `Hi, ${userName.split(' ')[0]}` : 'Telly'}
          </Text>
          {tellyId ? <Text style={styles.tellyIdTag}>Telly ID: {tellyId}</Text> : null}
        </View>
        <View style={styles.topActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('CallHistory')}>
            <Text style={styles.historyIcon}>🕐</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.signOutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </FadeInView>

      {/* Subscription badge — tapping while inactive navigates to subscribe */}
      <FadeInView delay={80}>
        <TouchableOpacity
          style={[styles.badge, isSubscribed ? styles.activeBadge : styles.inactiveBadge]}
          onPress={() => !isSubscribed && navigation.navigate('Subscription')}
          activeOpacity={isSubscribed ? 1 : 0.7}
        >
          <Text style={styles.badgeText}>
            {isSubscribed ? '✓ Telly Active' : '⚠ Tap to Subscribe — KES 500/month'}
          </Text>
        </TouchableOpacity>
      </FadeInView>

      <FadeInView delay={120}>
        <Text style={styles.sectionTitle}>Quick Contacts</Text>
        {successRate !== null && (
          <Text style={styles.reliabilityTag}>Telly Call Success Rate: {Math.round(successRate)}%</Text>
        )}
      </FadeInView>

      <FlatList
        data={DEMO_CONTACTS}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <FadeInView delay={150 + (index * 45)}>
            <TouchableOpacity onPress={() => handleCall(item.id)} activeOpacity={0.92}>
              <AppCard style={styles.contactRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.name[0]}</Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{item.name}</Text>
                  <Text style={styles.contactPhone}>{item.phone}</Text>
                </View>
                <View style={styles.callPill}>
                  <Text style={styles.callIcon}>📞</Text>
                </View>
              </AppCard>
            </TouchableOpacity>
          </FadeInView>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  bgOrbTop: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(82, 212, 240, 0.16)',
  },
  bgOrbBottom: {
    position: 'absolute',
    bottom: -160,
    left: -90,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(43, 208, 168, 0.1)',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  topLeft: { flex: 1 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kicker: { color: theme.colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  greeting: { color: theme.colors.text, fontSize: 24, fontWeight: '800', marginTop: 2 },
  tellyIdTag: { color: theme.colors.muted, fontSize: 12, marginTop: 4, fontWeight: '700' },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(82, 212, 240, 0.18)',
  },
  signOutBtn: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(247, 121, 113, 0.45)',
    backgroundColor: 'rgba(247, 121, 113, 0.1)',
  },
  logoutText: { color: '#ffd1cd', fontSize: 12, fontWeight: '700' },
  historyIcon: { fontSize: 18 },
  badge: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 14,
    padding: 13,
    alignItems: 'center',
    borderRadius: theme.radius.md,
    borderWidth: 1,
  },
  activeBadge: { backgroundColor: 'rgba(43, 208, 168, 0.15)', borderColor: 'rgba(43, 208, 168, 0.45)' },
  inactiveBadge: { backgroundColor: 'rgba(243, 181, 86, 0.15)', borderColor: 'rgba(243, 181, 86, 0.5)' },
  badgeText: { color: theme.colors.text, fontWeight: '700', fontSize: 13 },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginHorizontal: 16,
    marginBottom: 8,
  },
  reliabilityTag: {
    color: theme.colors.muted,
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 22 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 10,
    borderRadius: theme.radius.md,
    borderColor: 'rgba(82, 212, 240, 0.22)',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { color: theme.colors.background, fontSize: 19, fontWeight: '800' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  contactPhone: { fontSize: 13, color: theme.colors.muted, marginTop: 1 },
  callPill: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(82, 212, 240, 0.2)',
    borderRadius: theme.radius.pill,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callIcon: { fontSize: 18 },
});

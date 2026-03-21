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
import AppInput from '../components/AppInput';
import AppButton from '../components/AppButton';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

type ContactItem = {
  id: string;
  name: string;
  phone?: string;
  tellyId?: string;
  userId?: string;
};

const API_URL =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_URL
  ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.API_URL
  ?? 'https://api.telly.co.ke';

export default function HomeScreen({ navigation }: Props): React.JSX.Element {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [userName, setUserName] = useState('');
  const [tellyId, setTellyId] = useState('');
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [authToken, setAuthToken] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ContactItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [savingTellyId, setSavingTellyId] = useState<string | null>(null);

  const loadSavedContacts = async (token: string): Promise<void> => {
    try {
      const res = await fetch(`${API_URL}/telly-id/contacts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setContacts([]);
        return;
      }

      const payload = await res.json() as {
        contacts?: Array<{ id: string; tellyId: string; displayName?: string | null }>;
      };
      const realContacts = (payload.contacts ?? []).map((c) => ({
        id: c.id,
        name: c.displayName?.trim() || c.tellyId,
        tellyId: c.tellyId,
      }));
      setContacts(realContacts);
    } catch {
      setContacts([]);
    }
  };

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

    AsyncStorage.getItem('authToken').then((token) => {
      if (!token) return;
      setAuthToken(token);
      loadSavedContacts(token).catch(() => undefined);
    }).catch(() => undefined);

    signalingService.onIncomingCall((callId, callerId) => {
      navigation.navigate('IncomingCall', { callId, callerId });
    });

    signalingService.onSubscriptionGrace((message) => {
      Alert.alert('Subscription grace period', message);
    });
  }, [navigation]);

  const resolveRecipientId = async (contact: ContactItem): Promise<string | null> => {
    if (contact.userId) return contact.userId;
    if (!contact.tellyId) return null;

    try {
      const res = await fetch(`${API_URL}/telly-id/lookup/${encodeURIComponent(contact.tellyId)}`);
      if (!res.ok) return null;
      const payload = await res.json() as { userId?: string; isActive?: boolean; isSubscriptionValid?: boolean };
      if (!payload.userId || payload.isActive === false || payload.isSubscriptionValid === false) return null;
      return payload.userId;
    } catch {
      return null;
    }
  };

  const handleCall = async (contact: ContactItem): Promise<void> => {
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

    const recipientId = await resolveRecipientId(contact);
    if (!recipientId) {
      Alert.alert(
        'Recipient unavailable',
        'This contact could not be resolved to an active Telly user. Add a valid Telly ID contact and try again.',
      );
      return;
    }

    signalingService.warmupCall(recipientId);
    const callId = signalingService.initiateCall(recipientId);
    navigation.navigate('Call', {
      callId,
      remoteUserId: contact.name || contact.tellyId || recipientId,
      incoming: false,
    });
  };

  const handleSearch = async (): Promise<void> => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      Alert.alert('Search query too short', 'Enter at least 2 characters.');
      return;
    }
    if (!authToken) {
      Alert.alert('Not signed in', 'Please sign in again to search contacts.');
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`${API_URL}/contacts/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        Alert.alert('Search failed', 'Could not search contacts right now.');
        return;
      }
      const payload = await res.json() as {
        contacts?: Array<{ id: string; name: string; phoneNumber?: string; tellyId?: string | null }>;
      };
      const rows = (payload.contacts ?? []).map((c) => ({
        id: c.id,
        userId: c.id,
        name: c.name,
        phone: c.phoneNumber,
        tellyId: c.tellyId ?? undefined,
      }));
      setSearchResults(rows);
    } catch {
      Alert.alert('Search failed', 'Check your network and try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const isSaved = (candidate: ContactItem): boolean => {
    if (!candidate.tellyId) return false;
    return contacts.some((c) => c.tellyId === candidate.tellyId);
  };

  const handleSaveContact = async (candidate: ContactItem): Promise<void> => {
    if (!candidate.tellyId) {
      Alert.alert('Cannot save contact', 'This user has no Telly ID yet.');
      return;
    }
    if (!authToken) {
      Alert.alert('Not signed in', 'Please sign in again to save contacts.');
      return;
    }

    setSavingTellyId(candidate.tellyId);
    try {
      const res = await fetch(`${API_URL}/telly-id/contacts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tellyId: candidate.tellyId,
          displayName: candidate.name,
        }),
      });
      if (!res.ok) {
        Alert.alert('Save failed', 'Could not save this contact.');
        return;
      }
      await loadSavedContacts(authToken);
      Alert.alert('Saved', `${candidate.name} has been added to your contacts.`);
    } catch {
      Alert.alert('Save failed', 'Check your network and try again.');
    } finally {
      setSavingTellyId(null);
    }
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

      <FadeInView delay={140} style={styles.searchWrap}>
        <AppCard style={styles.searchCard}>
          <Text style={styles.searchTitle}>Add/Search Contacts</Text>
          <AppInput
            label="Find by name, phone, or Telly ID"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="e.g. alice or +2547..."
            autoCapitalize="none"
          />
          <View style={styles.searchBtnRow}>
            <AppButton
              label={isSearching ? 'Searching...' : 'Search Directory'}
              onPress={() => { handleSearch().catch(() => undefined); }}
              loading={isSearching}
              style={styles.searchBtn}
            />
          </View>
        </AppCard>
      </FadeInView>

      {searchResults.length > 0 && (
        <FadeInView delay={155}>
          <Text style={styles.sectionTitle}>Directory Results</Text>
          <FlatList
            data={searchResults}
            horizontal
            keyExtractor={(item) => `search-${item.id}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.searchResultsRow}
            renderItem={({ item }) => (
              <AppCard style={styles.searchResultCard}>
                <Text style={styles.searchResultName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.searchResultSub} numberOfLines={1}>{item.tellyId ?? item.phone ?? item.id}</Text>
                <View style={styles.searchActionsRow}>
                  <AppButton
                    label="Call"
                    onPress={() => { handleCall(item).catch(() => undefined); }}
                    style={styles.searchActionBtn}
                  />
                  {!isSaved(item) && (
                    <AppButton
                      label={savingTellyId === item.tellyId ? 'Saving...' : 'Save'}
                      onPress={() => { handleSaveContact(item).catch(() => undefined); }}
                      loading={savingTellyId === item.tellyId}
                      variant="ghost"
                      style={styles.searchActionBtn}
                    />
                  )}
                </View>
              </AppCard>
            )}
          />
        </FadeInView>
      )}

      <FlatList
        data={contacts}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <AppCard style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No saved contacts yet</Text>
            <Text style={styles.emptySub}>Use search above, then tap Save to add real Telly contacts.</Text>
          </AppCard>
        }
        renderItem={({ item, index }) => (
          <FadeInView delay={150 + (index * 45)}>
            <TouchableOpacity onPress={() => { handleCall(item).catch(() => undefined); }} activeOpacity={0.92}>
              <AppCard style={styles.contactRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.name[0]}</Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{item.name}</Text>
                  <Text style={styles.contactPhone}>{item.phone ?? item.tellyId ?? 'Telly contact'}</Text>
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
  searchWrap: { marginHorizontal: 16, marginBottom: 10 },
  searchCard: { padding: 12 },
  searchTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  searchBtnRow: { marginTop: 10 },
  searchBtn: { width: '100%' },
  searchResultsRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  searchResultCard: { width: 230, padding: 12 },
  searchResultName: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  searchResultSub: { color: theme.colors.muted, marginTop: 4, fontSize: 12 },
  searchActionsRow: { flexDirection: 'row', marginTop: 10, gap: 8 },
  searchActionBtn: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 22 },
  emptyCard: { padding: 14, marginTop: 8 },
  emptyTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  emptySub: { color: theme.colors.muted, marginTop: 4, fontSize: 12 },
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

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
  Modal,
  Share,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { signalingService } from '../services/SignalingService';
import { subscriptionService } from '../services/SubscriptionService';
import type { SubscriptionStatus } from '../services/SubscriptionService';
import { theme } from '../theme';
import AppCard from '../components/AppCard';
import FadeInView from '../components/FadeInView';
import AppInput from '../components/AppInput';
import AppButton from '../components/AppButton';
import Clipboard from '@react-native-clipboard/clipboard';

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
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(null);
  const [userName, setUserName] = useState('');
  const [tellyId, setTellyId] = useState('');
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [authToken, setAuthToken] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ContactItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [savingTellyId, setSavingTellyId] = useState<string | null>(null);
  const [resetCountdown, setResetCountdown] = useState('');
  const [showTellyWelcome, setShowTellyWelcome] = useState(false);
  const [pendingContact, setPendingContact] = useState<ContactItem | null>(null);
  const [customContactName, setCustomContactName] = useState('');
  const [showSaveContactModal, setShowSaveContactModal] = useState(false);

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

  const handleShareTellyId = async (): Promise<void> => {
    if (!tellyId) return;
    try {
      await Share.share({
        message: `My Telly ID is ${tellyId}. Add me on Telly to call for free.`,
      });
    } catch {
      Alert.alert('Share failed', 'Could not open the share dialog.');
    }
  };

  const handleCopyTellyId = (): void => {
    if (!tellyId) return;
    Clipboard.setString(tellyId);
    Alert.alert('Copied', 'Your Telly ID has been copied to the clipboard.');
  };

  useEffect(() => {
    subscriptionService.getStatus().then((s) => {
      setIsSubscribed(s.isSubscribed);
      setSubStatus(s);
    });
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

    signalingService.onSubscriptionGrace((message) => {
      Alert.alert('Subscription grace period', message);
    });

      signalingService.onSubscriptionBalance((balance) => {
        setSubStatus((prev) => ({
          isSubscribed: prev?.isSubscribed ?? false,
          subscriptionExpiry: prev?.subscriptionExpiry,
          dailyFreeMinutes: balance.dailyFreeMinutes,
          dailyMinutesUsed: balance.dailyMinutesUsed,
          freeMinutesRemaining: balance.freeMinutesRemaining,
          bonusMinutes: balance.bonusMinutes ?? prev?.bonusMinutes ?? 0,
          nextResetTime: balance.nextResetTime ?? prev?.nextResetTime,
          totalSavingsKes: prev?.totalSavingsKes,
        }));
        if (balance.freeMinutesRemaining <= 2 && (balance.bonusMinutes ?? 0) <= 0) {
          Alert.alert(
            'Free tier almost used',
            `Only ${balance.freeMinutesRemaining} free minute(s) remaining today. Subscribe for KES 100/month for unlimited calls.`,
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Subscribe', onPress: () => navigation.navigate('Subscription') },
          ],
        );
        }
      });
    }, [navigation]);

  useEffect(() => {
    if (!tellyId) return;
    AsyncStorage.getItem('tellyWelcomeShown').then((value) => {
      if (!value) setShowTellyWelcome(true);
    }).catch(() => undefined);
  }, [tellyId]);

  useEffect(() => {
    if (!subStatus?.nextResetTime) {
      setResetCountdown('');
      return;
    }
    const updateCountdown = (): void => {
      const target = new Date(subStatus.nextResetTime as string).getTime();
      const diff = Math.max(0, target - Date.now());
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      setResetCountdown(`${hours}h ${minutes}m`);
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 60000);
    return () => clearInterval(timer);
  }, [subStatus?.nextResetTime]);

  useEffect(() => {
    if (!subStatus || subStatus.isSubscribed) return;
    const dailyFree = subStatus.dailyFreeMinutes || 0;
    if (!dailyFree) return;
    const used = subStatus.dailyMinutesUsed || 0;
    if (used < Math.ceil(dailyFree / 2) || used >= dailyFree) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    AsyncStorage.getItem('halfwayNoticeDate').then((value) => {
      if (value === todayKey) return;
      Alert.alert('Halfway there', 'You\'re halfway through your free calls today.');
      AsyncStorage.setItem('halfwayNoticeDate', todayKey).catch(() => undefined);
    }).catch(() => undefined);
  }, [subStatus]);

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
      const availableMinutes = subStatus
        ? subStatus.freeMinutesRemaining + (subStatus.bonusMinutes ?? 0)
        : 0;
      if (!subStatus || availableMinutes <= 0) {
        Alert.alert(
          'No Free Minutes Left',
          'You\'ve used today\'s free minutes. Come back tomorrow or upgrade to keep calling.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Subscribe', onPress: () => navigation.navigate('Subscription') },
          ],
        );
        return;
      }
    }

    const recipientId = await resolveRecipientId(contact);
    if (!recipientId) {
      Alert.alert(
        'Recipient unavailable',
        'This contact could not be resolved to an active Telly user. Add a valid Telly ID contact and try again.',
      );
      return;
    }

    if (contact.tellyId) {
      signalingService.warmupCall(recipientId);
      const callId = signalingService.initiateCallByTellyId(contact.tellyId);
      navigation.navigate('Call', {
        callId,
        remoteUserId: contact.name || contact.tellyId || recipientId,
        incoming: false,
      });
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

  const handleSaveContact = async (candidate: ContactItem, displayName?: string): Promise<void> => {
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
          displayName: displayName?.trim() || candidate.name,
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

  const promptSaveContact = (candidate: ContactItem): void => {
    setPendingContact(candidate);
    setCustomContactName(candidate.name);
    setShowSaveContactModal(true);
  };

  const confirmSaveContact = (): void => {
    if (!pendingContact) return;
    setShowSaveContactModal(false);
    handleSaveContact(pendingContact, customContactName).catch(() => undefined);
    setPendingContact(null);
    setCustomContactName('');
  };

  const cancelSaveContact = (): void => {
    setShowSaveContactModal(false);
    setPendingContact(null);
    setCustomContactName('');
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

  const handleDismissWelcome = (): void => {
    setShowTellyWelcome(false);
    AsyncStorage.setItem('tellyWelcomeShown', 'true').catch(() => undefined);
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
            {isSubscribed
              ? '✓ Telly Active'
              : subStatus && (subStatus.freeMinutesRemaining > 0 || subStatus.bonusMinutes > 0)
                ? `🆓 ${subStatus.freeMinutesRemaining} free min${subStatus.bonusMinutes > 0 ? ` + ${subStatus.bonusMinutes} bonus` : ''} left today — Tap to upgrade`
                : '⚠ Tap to Subscribe — KES 100/month'}
          </Text>
        </TouchableOpacity>
        {!isSubscribed && subStatus && subStatus.freeMinutesRemaining <= 3 && subStatus.freeMinutesRemaining > 0 && (
          <Text style={styles.freeTierWarning}>
            Running low on free minutes. Subscribe for unlimited calls.
          </Text>
        )}
      </FadeInView>

      {!isSubscribed && subStatus && (
        <FadeInView delay={100} style={styles.freeTierCardWrap}>
          <AppCard style={styles.freeTierCard}>
            <Text style={styles.freeTierTitle}>Free minutes</Text>
            <Text style={styles.freeTierMain}>
              You have {subStatus.freeMinutesRemaining} free minutes today
            </Text>
            {subStatus.bonusMinutes > 0 && (
              <Text style={styles.bonusText}>You earned {subStatus.bonusMinutes} bonus minutes</Text>
            )}
            {resetCountdown ? (
              <Text style={styles.resetText}>Free minutes reset in {resetCountdown}</Text>
            ) : null}
            {subStatus.freeMinutesRemaining <= 0 && subStatus.bonusMinutes <= 0 && (
              <Text style={styles.freeUsedText}>
                You\'ve used today\'s free minutes. Come back tomorrow or upgrade.
              </Text>
            )}
          </AppCard>
        </FadeInView>
      )}

      {typeof subStatus?.totalSavingsKes === 'number' && (
        <FadeInView delay={110} style={styles.savingsCardWrap}>
          <AppCard style={styles.savingsCard}>
            <Text style={styles.savingsTitle}>Savings</Text>
            <Text style={styles.savingsValue}>
              You\'ve saved KES {subStatus.totalSavingsKes.toFixed(2)} using Telly
            </Text>
            {subStatus.totalSavingsKes >= 120 && (
              <Text style={styles.savingsBoost}>🔥 You’re saving more than most users</Text>
            )}
          </AppCard>
        </FadeInView>
      )}

      <FadeInView delay={120} style={styles.actionCardWrap}>
        <AppCard style={styles.actionCard}>
          <Text style={styles.actionTitle}>Quick Actions</Text>
          <View style={styles.actionRow}>
            <AppButton
              label="Invite Friends"
              onPress={() => navigation.navigate('InviteFriends')}
              style={styles.actionBtn}
            />
            <AppButton
              label="Report Issue"
              variant="ghost"
              onPress={() => navigation.navigate('ReportIssue')}
              style={styles.actionBtn}
            />
          </View>
        </AppCard>
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
                  {item.tellyId && !isSaved(item) && (
                    <AppButton
                        label={savingTellyId === item.tellyId ? 'Saving...' : 'Save'}
                        onPress={() => promptSaveContact(item)}
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

      <Modal
        visible={showSaveContactModal}
        transparent
        animationType="fade"
        onRequestClose={cancelSaveContact}
      >
        <View style={styles.modalBackdrop}>
          <AppCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Save contact</Text>
            <Text style={styles.modalSubtitle}>Add a custom name for this contact.</Text>
            <AppInput
              label="Contact name"
              value={customContactName}
              onChangeText={setCustomContactName}
              placeholder="e.g. Bestie"
            />
            <View style={styles.modalActions}>
              <AppButton label="Cancel" variant="ghost" onPress={cancelSaveContact} style={styles.modalActionBtn} />
              <AppButton label="Save" onPress={confirmSaveContact} style={styles.modalActionBtn} />
            </View>
          </AppCard>
        </View>
      </Modal>

      <Modal
        visible={showTellyWelcome}
        transparent
        animationType="fade"
        onRequestClose={handleDismissWelcome}
      >
        <View style={styles.modalBackdrop}>
          <AppCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Welcome to Telly 🎉</Text>
            <Text style={styles.modalSubtitle}>Your Telly ID is:</Text>
            <Text style={styles.modalTellyId}>{tellyId}</Text>
            <View style={styles.modalActions}>
              <AppButton label="Copy" onPress={handleCopyTellyId} style={styles.modalActionBtn} />
              <AppButton label="Share" variant="ghost" onPress={handleShareTellyId} style={styles.modalActionBtn} />
            </View>
            <AppButton label="Got it" onPress={handleDismissWelcome} style={styles.modalDismiss} />
          </AppCard>
        </View>
      </Modal>
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
  freeTierWarning: {
    color: theme.colors.muted,
    fontSize: 11,
    textAlign: 'center',
    marginHorizontal: 16,
    marginTop: -6,
    marginBottom: 6,
    fontWeight: '600',
  },
  freeTierCardWrap: { marginHorizontal: 16, marginBottom: 10 },
  freeTierCard: { padding: 14, borderColor: 'rgba(82, 212, 240, 0.2)' },
  freeTierTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  freeTierMain: { color: theme.colors.text, marginTop: 6, fontSize: 13, fontWeight: '600' },
  bonusText: { color: theme.colors.accent, marginTop: 6, fontSize: 12, fontWeight: '700' },
  resetText: { color: theme.colors.muted, marginTop: 4, fontSize: 12 },
  freeUsedText: { color: theme.colors.danger, marginTop: 6, fontSize: 12, fontWeight: '600' },
  savingsCardWrap: { marginHorizontal: 16, marginBottom: 10 },
  savingsCard: { padding: 14, borderColor: 'rgba(43, 208, 168, 0.25)' },
  savingsTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  savingsValue: { color: theme.colors.text, marginTop: 6, fontSize: 13, fontWeight: '600' },
  savingsBoost: { color: '#39d98a', marginTop: 6, fontSize: 12, fontWeight: '700' },
  actionCardWrap: { marginHorizontal: 16, marginBottom: 8 },
  actionCard: { padding: 14 },
  actionTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  actionBtn: { flex: 1 },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 12, 20, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: { width: '100%', padding: 20 },
  modalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  modalSubtitle: { color: theme.colors.muted, marginTop: 8, textAlign: 'center', fontSize: 12 },
  modalTellyId: { color: theme.colors.accent, marginTop: 10, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalActionBtn: { flex: 1 },
  modalDismiss: { marginTop: 12 },
});

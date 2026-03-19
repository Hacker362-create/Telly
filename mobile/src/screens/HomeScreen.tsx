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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { signalingService } from '../services/SignalingService';
import { subscriptionService } from '../services/SubscriptionService';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

const DEMO_CONTACTS = [
  { id: 'user-demo-1', name: 'Alice Kamau', phone: '+254711000001' },
  { id: 'user-demo-2', name: 'Bob Otieno', phone: '+254722000002' },
  { id: 'user-demo-3', name: 'Carol Njeri', phone: '+254733000003' },
];

export default function HomeScreen({ navigation }: Props): React.JSX.Element {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    subscriptionService.checkStatus().then(setIsSubscribed);
    AsyncStorage.getItem('userName').then((n) => setUserName(n ?? ''));

    signalingService.onIncomingCall((callId, callerId) => {
      Alert.alert('Incoming Call', `Call from ${callerId}`, [
        { text: 'Decline', style: 'destructive', onPress: () => signalingService.endCall(callId) },
        {
          text: 'Accept',
          onPress: () => navigation.navigate('Call', { callId, remoteUserId: callerId, incoming: true }),
        },
      ]);
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
          await AsyncStorage.multiRemove(['authToken', 'userId', 'userName', 'userPhone']);
          navigation.replace('Login');
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Top bar with greeting and logout */}
      <View style={styles.topBar}>
        <Text style={styles.greeting} numberOfLines={1}>
          {userName ? `Hi, ${userName.split(' ')[0]}` : 'Telly'}
        </Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Subscription badge — tapping while inactive navigates to subscribe */}
      <TouchableOpacity
        style={[styles.badge, isSubscribed ? styles.activeBadge : styles.inactiveBadge]}
        onPress={() => !isSubscribed && navigation.navigate('Subscription')}
        activeOpacity={isSubscribed ? 1 : 0.7}
      >
        <Text style={styles.badgeText}>
          {isSubscribed ? '✓ Telly Active' : '⚠ Tap to Subscribe — KES 500/month'}
        </Text>
      </TouchableOpacity>

      <FlatList
        data={DEMO_CONTACTS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.contactRow} onPress={() => handleCall(item.id)}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name[0]}</Text>
            </View>
            <View>
              <Text style={styles.contactName}>{item.name}</Text>
              <Text style={styles.contactPhone}>{item.phone}</Text>
            </View>
            <Text style={styles.callIcon}>📞</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1A237E',
  },
  greeting: { color: '#FFF', fontSize: 16, fontWeight: '600', flex: 1 },
  logoutText: { color: '#90CAF9', fontSize: 14 },
  badge: { padding: 12, alignItems: 'center' },
  activeBadge: { backgroundColor: '#4CAF50' },
  inactiveBadge: { backgroundColor: '#FF9800' },
  badgeText: { color: '#FFF', fontWeight: '600' },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFF',
    marginBottom: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1976D2',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  contactName: { fontSize: 16, fontWeight: '600', color: '#212121' },
  contactPhone: { fontSize: 13, color: '#757575' },
  callIcon: { marginLeft: 'auto', fontSize: 20 },
});

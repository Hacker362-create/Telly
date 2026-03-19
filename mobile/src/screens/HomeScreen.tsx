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

  useEffect(() => {
    subscriptionService.checkStatus().then(setIsSubscribed);

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
      Alert.alert('No Active Subscription', 'Subscribe for KES 500/month to make calls.');
      return;
    }
    const callId = signalingService.initiateCall(contactId);
    navigation.navigate('Call', { callId, remoteUserId: contactId, incoming: false });
  };

  return (
    <View style={styles.container}>
      <View style={[styles.badge, isSubscribed ? styles.activeBadge : styles.inactiveBadge]}>
        <Text style={styles.badgeText}>
          {isSubscribed ? '✓ Telly Active' : '⚠ Subscribe for KES 500/month'}
        </Text>
      </View>
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

// mobile/src/screens/CallScreen.tsx
// Active call screen with mute, speaker, and end call controls.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../App';
import { signalingService } from '../services/SignalingService';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Call'>;
  route: RouteProp<RootStackParamList, 'Call'>;
};

export default function CallScreen({ navigation, route }: Props): React.JSX.Element {
  const { callId, remoteUserId, incoming } = route.params;
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<'ringing' | 'connected' | 'ended'>(
    incoming ? 'ringing' : 'ringing',
  );

  useEffect(() => {
    if (!incoming) {
      signalingService.onCallAccepted(callId, () => setStatus('connected'));
    }

    signalingService.onCallEnded(callId, () => {
      setStatus('ended');
      setTimeout(() => navigation.goBack(), 1500);
    });

    let timer: ReturnType<typeof setInterval> | undefined;
    if (status === 'connected') {
      timer = setInterval(() => setDuration((d) => d + 1), 1000);
    }

    return () => {
      if (timer !== undefined) clearInterval(timer);
    };
  }, [callId, incoming, navigation, status]);

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleEndCall = (): void => {
    signalingService.endCall(callId);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{remoteUserId[0]?.toUpperCase() ?? '?'}</Text>
      </View>
      <Text style={styles.userId}>{remoteUserId}</Text>
      <Text style={styles.status}>
        {status === 'ringing' ? '🔔 Ringing...' : status === 'connected' ? formatDuration(duration) : '📵 Call Ended'}
      </Text>
      <Text style={styles.dataLabel}>Ultra-low data usage active</Text>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.btn, isMuted && styles.btnActive]}
          onPress={() => setIsMuted((m) => !m)}
        >
          <Text style={styles.btnIcon}>{isMuted ? '🔇' : '🎤'}</Text>
          <Text style={styles.btnLabel}>Mute</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, styles.endBtn]} onPress={handleEndCall}>
          <Text style={styles.btnIcon}>📵</Text>
          <Text style={styles.btnLabel}>End</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, isSpeaker && styles.btnActive]}
          onPress={() => setIsSpeaker((s) => !s)}
        >
          <Text style={styles.btnIcon}>{isSpeaker ? '🔊' : '🔈'}</Text>
          <Text style={styles.btnLabel}>Speaker</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1A237E', alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#3949AB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: { color: '#FFF', fontSize: 40, fontWeight: '700' },
  userId: { color: '#FFF', fontSize: 22, fontWeight: '600', marginBottom: 8 },
  status: { color: '#90CAF9', fontSize: 16, marginBottom: 4 },
  dataLabel: { color: '#42A5F5', fontSize: 12, marginBottom: 60 },
  controls: { flexDirection: 'row', gap: 24 },
  btn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#3949AB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnActive: { backgroundColor: '#283593' },
  endBtn: { backgroundColor: '#C62828' },
  btnIcon: { fontSize: 24 },
  btnLabel: { color: '#FFF', fontSize: 11, marginTop: 2 },
});

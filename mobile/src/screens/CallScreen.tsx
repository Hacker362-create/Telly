// mobile/src/screens/CallScreen.tsx
// Active call screen with real WebRTC audio, mute, speaker, and end call controls.
// Uses WebRTCService for SDP offer/answer + ICE candidate exchange.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../App';
import { signalingService } from '../services/SignalingService';
import { webRTCService } from '../services/WebRTCService';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Call'>;
  route: RouteProp<RootStackParamList, 'Call'>;
};

export default function CallScreen({ navigation, route }: Props): React.JSX.Element {
  const { callId, remoteUserId, incoming } = route.params;
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<'ringing' | 'dialing' | 'connected' | 'ended'>(
    incoming ? 'ringing' : 'dialing',
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── WebRTC setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    let didUnmount = false;

    const setupWebRTC = async (): Promise<void> => {
      await webRTCService.init();

      // Forward local ICE candidates to the remote peer via signaling
      webRTCService.onIceCandidate((candidate) => {
        signalingService.sendIceCandidate(callId, candidate);
      });

      if (!incoming) {
        // Caller: create offer and send it via signaling
        const offer = await webRTCService.createOffer();
        signalingService.sendOffer(callId, offer);

        // Wait for the callee's answer
        signalingService.onCallAccepted(callId, async (_, answer) => {
          if (answer) await webRTCService.setRemoteAnswer(answer);
          if (!didUnmount) setStatus('connected');
        });
      } else {
        // Callee: the offer already arrived with the call:incoming event.
        // Accept the incoming call — the answer is created inside acceptCall.
        signalingService.onOffer(callId, async (offer) => {
          const answer = await webRTCService.answerOffer(offer);
          signalingService.acceptCallWithAnswer(callId, answer);
          if (!didUnmount) setStatus('connected');
        });
      }

      // Handle remote ICE candidates received via signaling
      signalingService.onIceCandidate(callId, (candidate) => {
        webRTCService.addIceCandidate(candidate);
      });
    };

    setupWebRTC().catch((err) => {
      console.error('[CallScreen] WebRTC setup failed:', err);
    });

    signalingService.onCallEnded(callId, () => {
      if (!didUnmount) {
        setStatus('ended');
        setTimeout(() => navigation.goBack(), 1500);
      }
    });

    return () => {
      didUnmount = true;
      webRTCService.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, incoming]);

  // ── Call duration timer ─────────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'connected') {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleEndCall = (): void => {
    webRTCService.close();
    signalingService.endCall(callId);
    navigation.goBack();
  };

  const handleToggleMute = (): void => {
    const next = !isMuted;
    setIsMuted(next);
    webRTCService.setMuted(next);
  };

  // Speaker toggle is handled natively (via react-native-incall-manager in production)
  const handleToggleSpeaker = (): void => setIsSpeaker((s) => !s);

  const statusLabel =
    status === 'ringing' ? '🔔 Ringing...'
    : status === 'dialing' ? '📡 Dialing...'
    : status === 'connected' ? formatDuration(duration)
    : '📵 Call Ended';

  return (
    <View style={styles.container}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{remoteUserId[0]?.toUpperCase() ?? '?'}</Text>
      </View>
      <Text style={styles.userId}>{remoteUserId}</Text>
      <Text style={styles.status}>{statusLabel}</Text>
      <Text style={styles.dataLabel}>Ultra-low data · Opus DTX 16 kbps</Text>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.btn, isMuted && styles.btnActive]}
          onPress={handleToggleMute}
          accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
        >
          <Text style={styles.btnIcon}>{isMuted ? '🔇' : '🎤'}</Text>
          <Text style={styles.btnLabel}>Mute</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.endBtn]}
          onPress={handleEndCall}
          accessibilityLabel="End call"
        >
          <Text style={styles.btnIcon}>📵</Text>
          <Text style={styles.btnLabel}>End</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, isSpeaker && styles.btnActive]}
          onPress={handleToggleSpeaker}
          accessibilityLabel={isSpeaker ? 'Switch to earpiece' : 'Switch to speaker'}
        >
          <Text style={styles.btnIcon}>{isSpeaker ? '🔊' : '🔈'}</Text>
          <Text style={styles.btnLabel}>Speaker</Text>
        </TouchableOpacity>
      </View>

      {/* Platform indicator shown in dev — remove in production builds */}
      {__DEV__ && (
        <Text style={styles.devLabel}>
          {Platform.OS === 'ios' ? 'iOS' : 'Android'} · CallKit active
        </Text>
      )}
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
  devLabel: { position: 'absolute', bottom: 20, color: '#546E7A', fontSize: 11 },
});

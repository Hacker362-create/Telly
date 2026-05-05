// mobile/src/screens/CallScreen.tsx
// Active call screen with real WebRTC audio, mute, speaker, and end call controls.
// Uses WebRTCService for SDP offer/answer + ICE candidate exchange.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../App';
import { signalingService } from '../services/SignalingService';
import { webRTCService } from '../services/WebRTCService';
import { subscriptionService } from '../services/SubscriptionService';
import { theme } from '../theme';

const AIRTIME_COST_PER_MIN = 4.5;

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Call'>;
  route: RouteProp<RootStackParamList, 'Call'>;
};

export default function CallScreen({ navigation, route }: Props): React.JSX.Element {
  const { callId, remoteUserId, incoming } = route.params;
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [duration, setDuration] = useState(0);
  const [networkQuality, setNetworkQuality] = useState<'poor' | 'medium' | 'good'>('good');
  const [bitrate, setBitrate] = useState(16000);
  const [networkType, setNetworkType] = useState('unknown');
  const [status, setStatus] = useState<'ringing' | 'dialing' | 'connected' | 'ended'>(
    incoming ? 'ringing' : 'dialing',
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── WebRTC setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    let didUnmount = false;
    let relayRequested = false;

    const setupWebRTC = async (): Promise<void> => {
      await webRTCService.init();

      // Forward local ICE candidates to the remote peer via signaling
      webRTCService.onIceCandidate((candidate) => {
        signalingService.sendIceCandidate(callId, candidate);
      });

      webRTCService.onQualityChanged((quality, nextBitrate) => {
        setNetworkQuality(quality);
        setBitrate(nextBitrate);
      });

      webRTCService.onTelemetry((stats) => {
        if (!relayRequested && (stats.packetLossPct > 12 || stats.networkQuality === 'poor')) {
          relayRequested = true;
          webRTCService.enableRelayMode().catch(() => undefined);
          signalingService.requestRelayFallback(callId);
        }

        signalingService.sendReliabilitySnapshot(callId, {
          latencyMs: stats.latencyMs,
          packetLossPct: stats.packetLossPct,
          dataBytes: stats.bytesReceived + stats.bytesSent,
          networkType,
          iceRestartCount: webRTCService.getAdvancedStats().iceRestartCount,
          relayUsed: webRTCService.getAdvancedStats().relayMode,
          reconnectionEvents: webRTCService.getAdvancedStats().reconnectionEvents,
        });
      });

      signalingService.onIceRestart(callId, () => {
        webRTCService.restartIce().catch(() => undefined);
      });

      signalingService.onRelayMode(callId, () => {
        relayRequested = true;
        webRTCService.enableRelayMode().catch(() => undefined);
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

        signalingService.onCallQueued(callId, (etaMs) => {
          if (!didUnmount) {
            setStatus('dialing');
            Alert.alert('Call queued', `Callee is busy. Retrying in about ${Math.max(1, Math.round(etaMs / 1000))}s.`);
          }
        });

        signalingService.onCallUnavailable(callId, (_, reason) => {
          if (didUnmount) return;
          setStatus('ended');
          const label = reason === 'offline'
            ? 'Recipient is offline right now.'
            : reason === 'user_not_found'
              ? 'Recipient was not found.'
              : reason === 'cannot_call_self'
                ? 'You cannot call yourself.'
                : 'Recipient is unavailable.';
          Alert.alert('Call unavailable', label);
          setTimeout(() => navigation.goBack(), 300);
        });

        signalingService.onCallRejected(callId, () => {
          if (didUnmount) return;
          setStatus('ended');
          Alert.alert('Call declined', `${remoteUserId} declined the call.`);
          setTimeout(() => navigation.goBack(), 300);
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

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const type = state.type ?? 'unknown';
      setNetworkType(type);
      if (!state.isConnected) return;
      webRTCService.handleNetworkChange().catch(() => undefined);
      signalingService.triggerIceRestart(callId);
    });

    signalingService.onCallEnded(callId, () => {
      if (!didUnmount) {
        setStatus('ended');
        setTimeout(() => navigation.goBack(), 1500);
      }
    });

    return () => {
      didUnmount = true;
      unsubscribeNetInfo();
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
    const telemetry = webRTCService.getTelemetry();
    const totalBytes = telemetry.bytesSent + telemetry.bytesReceived;
    const tellyMb = totalBytes / (1024 * 1024);
    const waMb = tellyMb * 2.8;
    const durationMinutes = Math.max(0, duration) / 60;
    const estimatedAirtimeCost = Math.round(durationMinutes * AIRTIME_COST_PER_MIN * 100) / 100;
    const estimatedSavings = estimatedAirtimeCost;
    const success = status === 'connected' && duration >= 5;

    signalingService.endCall(callId, {
      durationMs: duration * 1000,
      dataBytes: Math.round(totalBytes),
      avgLatencyMs: telemetry.latencyMs,
      packetLossPct: telemetry.packetLossPct,
      success,
      networkType,
      iceRestartCount: webRTCService.getAdvancedStats().iceRestartCount,
      relayUsed: webRTCService.getAdvancedStats().relayMode,
      reconnectionEvents: webRTCService.getAdvancedStats().reconnectionEvents,
    });

    webRTCService.close();

    // Check free-tier status after call ends — prompt upgrade if limit is near/hit
    subscriptionService.getStatus().then((subStatus) => {
      const dataMsg = `This call used ${tellyMb.toFixed(2)} MB\nAirtime would cost ~KES ${estimatedAirtimeCost.toFixed(2)}\nYou saved KES ${estimatedSavings.toFixed(2)}`;
      const availableMinutes = subStatus.freeMinutesRemaining + (subStatus.bonusMinutes ?? 0);
      if (!subStatus.isSubscribed && availableMinutes <= 0) {
        Alert.alert(
          'Free minutes used up',
          `${dataMsg}\n\nYou've used today's free minutes. Come back tomorrow or upgrade.`,
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Subscribe', onPress: () => navigation.replace('Subscription') },
          ],
        );
      } else if (!subStatus.isSubscribed && subStatus.freeMinutesRemaining <= 2) {
        Alert.alert(
          'Call usage',
          `${dataMsg}\n\nOnly ${subStatus.freeMinutesRemaining} free minute(s) left today. Consider subscribing for unlimited calls.`,
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Subscribe', onPress: () => navigation.replace('Subscription') },
          ],
        );
      } else {
        Alert.alert('Call usage', dataMsg);
      }
      navigation.goBack();
    }).catch(() => {
      Alert.alert(
        'Call usage',
        `This call used ${tellyMb.toFixed(2)} MB.\nWhatsApp estimate: ~${waMb.toFixed(2)} MB`,
      );
      navigation.goBack();
    });
  };

  const handleToggleMute = (): void => {
    const next = !isMuted;
    setIsMuted(next);
    webRTCService.setMuted(next);
  };

  // Speaker toggle is handled natively (via react-native-incall-manager in production)
  const handleToggleSpeaker = (): void => setIsSpeaker((s) => !s);

  const statusLabel =
    status === 'ringing' ? 'Ringing...'
    : status === 'dialing' ? 'Dialing...'
    : status === 'connected' ? 'Connected'
    : 'Call Ended';

  const displayDuration = status === 'connected' ? formatDuration(duration) : statusLabel;

  return (
    <View style={styles.container}>
      {/* Status bar at top */}
      <View style={styles.statusBar}>
        {status === 'connected' && (
          <Text style={styles.networkStatus}>{networkQuality.toUpperCase()} • {bitrate / 1000} kbps</Text>
        )}
        {status !== 'connected' && status !== 'ended' && (
          <Text style={styles.networkStatus}>{statusLabel}</Text>
        )}
      </View>

      {/* Caller info and timer - centered */}
      <View style={styles.info}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{remoteUserId[0]?.toUpperCase() ?? '?'}</Text>
        </View>
        <Text style={styles.userId}>{remoteUserId}</Text>
        <Text style={styles.timer}>{displayDuration}</Text>
      </View>

      {/* Controls at bottom */}
      <View style={styles.controlsContainer}>
        <View style={styles.topControls}>
          <TouchableOpacity
            style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
            onPress={handleToggleMute}
            accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
          >
            <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
            <Text style={styles.controlLabel}>Mute</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlBtn, isSpeaker && styles.controlBtnActive]}
            onPress={handleToggleSpeaker}
            accessibilityLabel={isSpeaker ? 'Switch to earpiece' : 'Switch to speaker'}
          >
            <Text style={styles.controlIcon}>{isSpeaker ? '🔊' : '🔈'}</Text>
            <Text style={styles.controlLabel}>Speaker</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.endCallBtn}
          onPress={handleEndCall}
          accessibilityLabel="End call"
        >
          <Text style={styles.endCallIcon}>📞</Text>
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
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  statusBar: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(82, 212, 240, 0.1)',
  },
  networkStatus: {
    color: theme.colors.muted,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: theme.colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 2,
    borderColor: 'rgba(82, 212, 240, 0.5)',
  },
  avatarText: {
    color: theme.colors.text,
    fontSize: 56,
    fontWeight: '700',
  },
  userId: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  timer: {
    color: theme.colors.accent,
    fontSize: 36,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  controlsContainer: {
    paddingHorizontal: 24,
    gap: 20,
  },
  topControls: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
  },
  controlBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(82, 212, 240, 0.3)',
  },
  controlBtnActive: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: 'rgba(82, 212, 240, 0.6)',
  },
  controlIcon: {
    fontSize: 28,
  },
  controlLabel: {
    color: theme.colors.text,
    fontSize: 11,
    marginTop: 4,
    fontWeight: '500',
  },
  endCallBtn: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: theme.colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(247, 121, 113, 0.8)',
    alignSelf: 'center',
    shadowColor: theme.colors.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  endCallIcon: {
    fontSize: 40,
    transform: [{ rotate: '225deg' }],
  },
  devLabel: {
    position: 'absolute',
    bottom: 20,
    color: theme.colors.muted,
    fontSize: 11,
  },
});

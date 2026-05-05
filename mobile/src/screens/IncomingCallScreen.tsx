// mobile/src/screens/IncomingCallScreen.tsx
// Incoming call screen with accept/decline interface similar to native phone app

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../App';
import { signalingService } from '../services/SignalingService';
import { theme } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'IncomingCall'>;
  route: RouteProp<RootStackParamList, 'IncomingCall'>;
};

export default function IncomingCallScreen({ navigation, route }: Props): React.JSX.Element {
  const { callId, callerId } = route.params;
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const pulseAnim = new Animated.Value(1);

  // Pulsing animation for the incoming call indicator
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [pulseAnim]);

  const handleAccept = async (): Promise<void> => {
    setIsAccepting(true);
    try {
      navigation.navigate('Call', { callId, remoteUserId: callerId, incoming: true });
    } catch (error) {
      console.error('Failed to accept call:', error);
      setIsAccepting(false);
    }
  };

  const handleDecline = (): void => {
    setIsDeclining(true);
    signalingService.rejectCall(callId, 'declined');
    setTimeout(() => navigation.goBack(), 300);
  };

  return (
    <View style={styles.container}>
      {/* Background gradient-like effect */}
      <View style={styles.bgGradient} />

      {/* Ringing indicator */}
      <Animated.View style={[styles.pulsing, { transform: [{ scale: pulseAnim }] }]}>
        <View style={styles.pulseRing} />
      </Animated.View>

      {/* Caller info */}
      <View style={styles.callerInfo}>
        <View style={styles.largeAvatar}>
          <Text style={styles.largeAvatarText}>{callerId[0]?.toUpperCase() ?? '?'}</Text>
        </View>
        <Text style={styles.callerName}>{callerId}</Text>
        <Text style={styles.incomingLabel}>Incoming Call</Text>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        {/* Decline button */}
        <TouchableOpacity
          style={[styles.button, styles.declineButton, isDeclining && styles.buttonPressed]}
          onPress={handleDecline}
          disabled={isAccepting || isDeclining}
          accessibilityLabel="Decline call"
        >
          <Text style={styles.buttonText}>Decline</Text>
        </TouchableOpacity>

        {/* Accept button */}
        <TouchableOpacity
          style={[styles.button, styles.acceptButton, isAccepting && styles.buttonPressed]}
          onPress={handleAccept}
          disabled={isAccepting || isDeclining}
          accessibilityLabel="Accept call"
        >
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 40,
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
    backgroundColor: 'rgba(82, 212, 240, 0.1)',
  },
  pulsing: {
    marginTop: 60,
  },
  pulseRing: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 2,
    borderColor: 'rgba(82, 212, 240, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callerInfo: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  largeAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: theme.colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 2,
    borderColor: 'rgba(82, 212, 240, 0.5)',
  },
  largeAvatarText: {
    color: theme.colors.text,
    fontSize: 48,
    fontWeight: '700',
  },
  callerName: {
    color: theme.colors.text,
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  incomingLabel: {
    color: theme.colors.accent,
    fontSize: 16,
    fontWeight: '500',
  },
  controls: {
    width: '100%',
    paddingHorizontal: 24,
    gap: 16,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  declineButton: {
    borderColor: theme.colors.danger,
    backgroundColor: 'rgba(247, 121, 113, 0.1)',
  },
  buttonText: {
    color: theme.colors.danger,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  acceptButton: {
    borderColor: theme.colors.accent,
    backgroundColor: 'rgba(82, 212, 240, 0.1)',
  },
  acceptButtonText: {
    color: theme.colors.accent,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});

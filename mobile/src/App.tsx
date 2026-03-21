// mobile/src/App.tsx
// Root component for the Telly mobile app.
// Checks AsyncStorage for a stored auth token on startup; if absent routes to Login.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import HomeScreen from './screens/HomeScreen';
import CallScreen from './screens/CallScreen';
import IncomingCallScreen from './screens/IncomingCallScreen';
import SubscriptionScreen from './screens/SubscriptionScreen';
import CallHistoryScreen from './screens/CallHistoryScreen';
import { signalingService } from './services/SignalingService';
import { theme } from './theme';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Home: undefined;
  IncomingCall: { callId: string; callerId: string };
  Call: { callId: string; remoteUserId: string; incoming: boolean };
  Subscription: undefined;
  CallHistory: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
const stackScreenOptions = {
  headerStyle: { backgroundColor: theme.colors.surface },
  headerTitleStyle: { color: theme.colors.text, fontWeight: '700' as const },
  headerTintColor: theme.colors.text,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: theme.colors.background },
};

export default function App(): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      const [token, userId] = await Promise.all([
        AsyncStorage.getItem('authToken'),
        AsyncStorage.getItem('userId'),
      ]);

      if (token && userId) {
        // Re-connect the signaling socket with the stored credentials.
        // FCM token will be sent by the native push module once available,
        // not from AsyncStorage — pass undefined here.
        signalingService.connect(userId, token);
        setIsAuthenticated(true);
      }
      setIsLoading(false);
    };

    bootstrap().catch(console.error);
  }, []);

  useEffect(() => {
    signalingService.onIncomingCall((callId, callerId) => {
      if (!navigationRef.isReady()) return;
      navigationRef.navigate('IncomingCall', { callId, callerId });
    });
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator initialRouteName={isAuthenticated ? 'Home' : 'Login'} screenOptions={stackScreenOptions}>
        {/* Auth flow — no header needed */}
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Create Account' }} />
        {/* Main app */}
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Telly Hub' }} />
        <Stack.Screen name="IncomingCall" component={IncomingCallScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Subscription" component={SubscriptionScreen} options={{ title: 'Subscription' }} />
        <Stack.Screen name="CallHistory" component={CallHistoryScreen} options={{ title: 'Recent Calls' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

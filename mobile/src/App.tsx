// mobile/src/App.tsx
// Root component for the Telly mobile app.
// Checks AsyncStorage for a stored auth token on startup; if absent routes to Login.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import HomeScreen from './screens/HomeScreen';
import CallScreen from './screens/CallScreen';
import SubscriptionScreen from './screens/SubscriptionScreen';
import CallHistoryScreen from './screens/CallHistoryScreen';
import { signalingService } from './services/SignalingService';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Home: undefined;
  Call: { callId: string; remoteUserId: string; incoming: boolean };
  Subscription: undefined;
  CallHistory: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A237E' }}>
        <ActivityIndicator size="large" color="#FFF" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName={isAuthenticated ? 'Home' : 'Login'}>
        {/* Auth flow — no header needed */}
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="Register"
          component={RegisterScreen}
          options={{ title: 'Create Account', headerStyle: { backgroundColor: '#1A237E' }, headerTintColor: '#FFF' }}
        />
        {/* Main app */}
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Telly' }} />
        <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="Subscription"
          component={SubscriptionScreen}
          options={{ title: 'Subscribe', headerStyle: { backgroundColor: '#1A237E' }, headerTintColor: '#FFF' }}
        />
        <Stack.Screen
          name="CallHistory"
          component={CallHistoryScreen}
          options={{ title: 'Recent Calls', headerStyle: { backgroundColor: '#1A237E' }, headerTintColor: '#FFF' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

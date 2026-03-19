// mobile/src/App.tsx
// Root component for the Telly mobile app.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './screens/HomeScreen';
import CallScreen from './screens/CallScreen';

export type RootStackParamList = {
  Home: undefined;
  Call: { callId: string; remoteUserId: string; incoming: boolean };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App(): React.JSX.Element {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Telly' }} />
        <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

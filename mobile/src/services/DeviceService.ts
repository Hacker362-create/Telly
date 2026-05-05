import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = 'deviceId';

function generateDeviceId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  return `dev_${timestamp}_${random}`;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const deviceId = generateDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

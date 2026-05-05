import * as React from 'react';
import { useRef } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, Animated, StyleProp, ViewStyle } from 'react-native';
import { theme } from '../theme';

type Variant = 'primary' | 'success' | 'danger' | 'ghost';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
};

export default function AppButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  style,
}: Props): React.JSX.Element {
  const scale = useRef(new Animated.Value(1)).current;
  const locked = disabled || loading;

  const pressIn = (): void => {
    Animated.spring(scale, {
      toValue: 0.97,
      speed: 30,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  };

  const pressOut = (): void => {
    Animated.spring(scale, {
      toValue: 1,
      speed: 24,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  };

  return React.createElement(
    Animated.View,
    { style: [{ transform: [{ scale }] }, style] },
    React.createElement(
      TouchableOpacity,
      {
        style: [styles.button, styles[variant], locked && styles.disabled],
        onPress,
        onPressIn: pressIn,
        onPressOut: pressOut,
        disabled: locked,
        activeOpacity: 0.95,
      },
      loading
        ? React.createElement(ActivityIndicator, {
            color: variant === 'ghost' ? theme.colors.text : theme.colors.background,
          })
        : React.createElement(
            Text,
            { style: [styles.text, variant === 'ghost' && styles.ghostText] },
            label,
          ),
    ),
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: theme.radius.sm,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  primary: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  success: {
    backgroundColor: theme.colors.success,
    borderColor: theme.colors.success,
  },
  danger: {
    backgroundColor: theme.colors.danger,
    borderColor: theme.colors.danger,
  },
  ghost: {
    backgroundColor: 'rgba(82, 212, 240, 0.08)',
    borderColor: 'rgba(82, 212, 240, 0.28)',
  },
  text: {
    color: theme.colors.background,
    fontSize: 16,
    fontWeight: '800',
  },
  ghostText: {
    color: theme.colors.text,
  },
  disabled: {
    opacity: 0.55,
  },
});

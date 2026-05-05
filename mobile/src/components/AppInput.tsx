import React from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { theme } from '../theme';

type Props = {
  label: string;
} & TextInputProps;

export default function AppInput({ label, ...props }: Props): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={theme.colors.muted}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  label: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(82, 212, 240, 0.22)',
    borderRadius: theme.radius.sm,
    padding: 12,
    fontSize: 15,
    color: theme.colors.text,
    backgroundColor: 'rgba(7, 25, 34, 0.8)',
  },
});

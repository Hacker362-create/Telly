// mobile/src/screens/CallHistoryScreen.tsx
// Displays the user's past calls fetched from GET /calls/history.
// Supports pull-to-refresh and infinite scroll pagination.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { theme } from '../theme';
import AppButton from '../components/AppButton';
import AppCard from '../components/AppCard';
import FadeInView from '../components/FadeInView';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CallHistory'>;
};

interface CallLogEntry {
  id: string;
  callerId: string;
  calleeId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

interface HistoryResponse {
  calls: CallLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

const API_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.API_URL
  ?? 'https://api.telly.co.ke';
const PAGE_SIZE = 20;

async function fetchHistory(page: number): Promise<HistoryResponse> {
  const token = await AsyncStorage.getItem('authToken');
  const res = await fetch(
    `${API_URL}/calls/history?page=${page}&limit=${PAGE_SIZE}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!res.ok) throw new Error('Failed to load call history');
  return res.json() as Promise<HistoryResponse>;
}

function formatDuration(ms: number | null): string {
  if (!ms) return '< 1 s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CallHistoryScreen({ navigation }: Props): React.JSX.Element {
  const [userId, setUserId] = useState<string>('');
  const [calls, setCalls] = useState<CallLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('userId').then((id) => setUserId(id ?? ''));
  }, []);

  const loadPage = useCallback(async (pageNum: number, replace: boolean): Promise<void> => {
    try {
      setError(null);
      const data = await fetchHistory(pageNum);
      setCalls((prev) => replace ? data.calls : [...prev, ...data.calls]);
      setHasMore(data.pagination.hasMore);
      setPage(pageNum);
    } catch {
      setError('Could not load call history. Pull to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPage(1, true);
  }, [loadPage]);

  const handleRefresh = (): void => {
    setRefreshing(true);
    loadPage(1, true);
  };

  const handleLoadMore = (): void => {
    if (!hasMore || loading) return;
    loadPage(page + 1, false);
  };

  const renderItem = ({ item, index }: { item: CallLogEntry; index: number }): React.JSX.Element => {
    const isOutgoing = item.callerId === userId;
    const remoteId = isOutgoing ? item.calleeId : item.callerId;
    const connected = item.endedAt !== null;

    return (
      <FadeInView delay={40 + (index * 25)}>
      <AppCard style={styles.row}>
        {/* Direction icon */}
        <View style={[styles.dirIcon, isOutgoing ? styles.outIcon : styles.inIcon]}>
          <Text style={styles.dirText}>{isOutgoing ? '↗' : '↙'}</Text>
        </View>

        {/* Call info */}
        <View style={styles.info}>
          <Text style={styles.remoteId} numberOfLines={1}>{remoteId}</Text>
          <Text style={styles.meta}>
            {isOutgoing ? 'Outgoing' : 'Incoming'} · {connected ? formatDuration(item.durationMs) : 'Missed'}
          </Text>
        </View>

        {/* Timestamp */}
        <Text style={styles.timestamp}>{formatDate(item.startedAt)}</Text>
      </AppCard>
      </FadeInView>
    );
  };

  if (loading && calls.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  if (error && calls.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <AppButton label="Retry" onPress={handleRefresh} style={styles.retryBtn} />
      </View>
    );
  }

  return (
    <FlatList
      data={calls}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      style={styles.list}
      contentContainerStyle={calls.length === 0 ? styles.emptyContainer : undefined}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.colors.accent} />
      }
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.3}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No calls yet</Text>
          <AppButton label="Make your first call" onPress={() => navigation.navigate('Home')} style={styles.retryBtn} />
        </View>
      }
      ListFooterComponent={
        hasMore && !refreshing ? (
          <ActivityIndicator size="small" color={theme.colors.accent} style={styles.footer} />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.colors.background },
  emptyContainer: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: theme.colors.background },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(82, 212, 240, 0.15)',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: theme.radius.md,
    borderColor: 'rgba(82, 212, 240, 0.18)',
  },
  dirIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  outIcon: { backgroundColor: 'rgba(82, 212, 240, 0.2)' },
  inIcon: { backgroundColor: 'rgba(43, 208, 168, 0.18)' },
  dirText: { fontSize: 18 },
  info: { flex: 1 },
  remoteId: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  meta: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  timestamp: { fontSize: 11, color: theme.colors.muted },
  footer: { padding: 16 },
  emptyText: { fontSize: 16, color: theme.colors.muted, marginBottom: 16 },
  errorText: { fontSize: 15, color: theme.colors.danger, marginBottom: 16, textAlign: 'center' },
  retryBtn: { width: 220 },
});

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
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';

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

const API_URL = process.env.API_URL ?? 'https://api.telly.co.ke';
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

  const renderItem = ({ item }: { item: CallLogEntry }): React.JSX.Element => {
    const isOutgoing = item.callerId === userId;
    const remoteId = isOutgoing ? item.calleeId : item.callerId;
    const connected = item.endedAt !== null;

    return (
      <View style={styles.row}>
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
      </View>
    );
  };

  if (loading && calls.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1A237E" />
      </View>
    );
  }

  if (error && calls.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={handleRefresh} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
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
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#1A237E" />
      }
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.3}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No calls yet</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Home')} style={styles.retryBtn}>
            <Text style={styles.retryText}>Make your first call</Text>
          </TouchableOpacity>
        </View>
      }
      ListFooterComponent={
        hasMore && !refreshing ? (
          <ActivityIndicator size="small" color="#1A237E" style={styles.footer} />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#F5F5F5' },
  emptyContainer: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  dirIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  outIcon: { backgroundColor: '#E3F2FD' },
  inIcon: { backgroundColor: '#E8F5E9' },
  dirText: { fontSize: 18 },
  info: { flex: 1 },
  remoteId: { fontSize: 15, fontWeight: '600', color: '#212121' },
  meta: { fontSize: 12, color: '#757575', marginTop: 2 },
  timestamp: { fontSize: 11, color: '#9E9E9E' },
  footer: { padding: 16 },
  emptyText: { fontSize: 16, color: '#9E9E9E', marginBottom: 16 },
  errorText: { fontSize: 15, color: '#C62828', marginBottom: 16, textAlign: 'center' },
  retryBtn: {
    backgroundColor: '#1A237E',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: { color: '#FFF', fontWeight: '600' },
});

import { memo, useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { LiveLogEntry, RealtimeConnectionState } from '@/lib/api';

function levelTone(level: LiveLogEntry['level']) {
  switch (level) {
    case 'error':
      return styles.errorBadge;
    case 'warn':
      return styles.warnBadge;
    case 'info':
      return styles.infoBadge;
    default:
      return styles.logBadge;
  }
}

function timeLabel(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString('pt-BR');
}

function LiveConsoleComponent({
  logs,
  connectionState,
}: {
  logs: LiveLogEntry[];
  connectionState: RealtimeConnectionState;
}) {
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [logs.length]);

  const headerLabel = useMemo(() => {
    switch (connectionState) {
      case 'open':
        return 'Tempo real';
      case 'connecting':
        return 'Conectando...';
      case 'reconnecting':
        return 'Reconectando...';
      case 'error':
        return 'Conexão instável';
      case 'closed':
        return 'Conexão encerrada';
      default:
        return 'Aguardando eventos';
    }
  }, [connectionState]);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Console ao vivo</Text>
        <Text style={styles.subtitle}>{headerLabel}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.console}
        contentContainerStyle={styles.consoleContent}
        showsVerticalScrollIndicator={false}>
        {logs.length === 0 ? (
          <Text style={styles.emptyText}>Nenhum log recebido ainda.</Text>
        ) : (
          logs.map((item) => (
            <View key={item.id} style={styles.row}>
              <Text style={[styles.badge, levelTone(item.level)]}>{item.level.toUpperCase()}</Text>
              <Text style={styles.timestamp}>{timeLabel(item.timestamp)}</Text>
              <Text style={styles.message}>{item.message}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

export const LiveConsole = memo(LiveConsoleComponent);

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  headerRow: {
    gap: 3,
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    fontWeight: '700',
  },
  console: {
    minHeight: 260,
    maxHeight: 360,
    borderRadius: 18,
    backgroundColor: 'rgba(5, 10, 22, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  consoleContent: {
    padding: 14,
    gap: 10,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
  },
  row: {
    gap: 4,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  logBadge: {
    backgroundColor: 'rgba(59,130,246,0.25)',
  },
  infoBadge: {
    backgroundColor: 'rgba(34,197,94,0.25)',
  },
  warnBadge: {
    backgroundColor: 'rgba(245,158,11,0.25)',
  },
  errorBadge: {
    backgroundColor: 'rgba(239,68,68,0.28)',
  },
  timestamp: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '700',
  },
  message: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 19,
  },
});

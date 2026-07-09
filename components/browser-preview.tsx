import { memo, useMemo } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import { ApiStatus } from '@/lib/api';
import { BrowserFrameViewModel } from '@/hooks/use-backend-realtime';

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function BrowserPreviewComponent({
  browserFrame,
  browserSession,
  browserStatusLabel,
  currentStep,
}: {
  browserFrame: BrowserFrameViewModel;
  browserSession: ApiStatus['browserView'] | null;
  browserStatusLabel: string;
  currentStep: string;
}) {
  const hasImage = Boolean(browserFrame.imageUri);
  const stepLabel = useMemo(() => {
    return currentStep || browserFrame.label || browserSession?.label || 'Aguardando execução';
  }, [browserFrame.label, browserFrame.imageUri, browserSession?.label, currentStep]);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Browser ao vivo</Text>
          <Text style={styles.subtitle}>Atualizado por browser-session e browser-frame</Text>
        </View>
        <View style={styles.badgeRow}>
          <Badge label={browserStatusLabel || 'idle'} />
          <Badge label={browserSession?.active ? 'ativo' : 'inativo'} />
        </View>
      </View>

      <View style={styles.previewBox}>
        {hasImage ? (
          <Image source={{ uri: browserFrame.imageUri ?? undefined }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>Nenhum frame recebido ainda</Text>
            <Text style={styles.placeholderText}>
              O backend publica a imagem em tempo real pelo stream browser-frame.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.metaCard}>
        <Text style={styles.metaLabel}>Passo atual</Text>
        <Text style={styles.metaValue}>{stepLabel}</Text>

        <View style={styles.metaGrid}>
          <View style={styles.metaItem}>
            <Text style={styles.metaKey}>Run ID</Text>
            <Text style={styles.metaVal}>{browserFrame.runId || browserSession?.runId || '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaKey}>Página</Text>
            <Text style={styles.metaVal}>{browserFrame.pageUrl || '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaKey}>Label do frame</Text>
            <Text style={styles.metaVal}>{browserFrame.label || browserSession?.lastFrameLabel || '—'}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.note}>
        {Platform.OS === 'web'
          ? 'A imagem é renderizada diretamente via data URI no navegador.'
          : 'O frame é renderizado localmente no app usando data URI base64.'}
      </Text>
    </View>
  );
}

export const BrowserPreview = memo(BrowserPreviewComponent);

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
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
    marginTop: 3,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  previewBox: {
    minHeight: 250,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(5, 10, 22, 0.98)',
  },
  image: {
    width: '100%',
    height: 280,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  placeholder: {
    minHeight: 250,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 8,
  },
  placeholderTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.60)',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  metaCard: {
    gap: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  metaLabel: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 12,
    fontWeight: '700',
  },
  metaValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  metaGrid: {
    gap: 10,
    marginTop: 6,
  },
  metaItem: {
    gap: 4,
  },
  metaKey: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '700',
  },
  metaVal: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 19,
  },
  note: {
    color: 'rgba(255,255,255,0.50)',
    fontSize: 12,
    lineHeight: 18,
  },
});

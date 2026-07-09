import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IntentLauncher from 'expo-intent-launcher';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BrowserPreview } from '@/components/browser-preview';
import { LiveConsole } from '@/components/live-console';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  API_PASSWORD,
  DEFAULT_BACKEND_URL,
  HealthState,
  STORAGE_ACCESS_CODE_KEY,
  STORAGE_BACKEND_URL_KEY,
  buildUrl,
  formatDateTime,
  isWifiNameValid,
  isWifiPasswordValid,
  normalizeBackendUrl,
  normalizeWifiPassword,
  stringifyError,
} from '@/lib/api';
import { useBackendRealtime } from '@/hooks/use-backend-realtime';

const HEALTH_TIMEOUT_MS = 2500;
const STATUS_POLL_NOTE = 'SSE ativo: logs e frames não usam polling.';
const ASCII_HINT = 'Use apenas caracteres ASCII imprimíveis no SSID.';

function Chip({ label, tone }: { label: string; tone: 'good' | 'warn' | 'bad' | 'info' }) {
  return (
    <View
      style={[
        styles.chip,
        tone === 'good' && styles.chipGood,
        tone === 'warn' && styles.chipWarn,
        tone === 'bad' && styles.chipBad,
        tone === 'info' && styles.chipInfo,
      ]}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

function SectionTitle({ icon, title, subtitle }: { icon: keyof typeof IconMap; title: string; subtitle?: string }) {
  const Component = IconMap[icon];
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIconWrap}>
        <Component size={18} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const IconMap = {
  Cloud: (props: any) => <IconSymbol name="cloud.fill" {...props} />,
  Gear: (props: any) => <IconSymbol name="gearshape.fill" {...props} />,
  Check: (props: any) => <IconSymbol name="checkmark.circle.fill" {...props} />,
  Warning: (props: any) => <IconSymbol name="exclamationmark.triangle.fill" {...props} />,
} as const;

type HealthTone = 'good' | 'warn' | 'bad' | 'info';

export default function HomeScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const initialCode = useMemo(() => {
    const code = params.code;
    return typeof code === 'string' ? code : Array.isArray(code) ? code[0] : '';
  }, [params.code]);

  const [healthState, setHealthState] = useState<HealthState>('checking');
  const [healthMessage, setHealthMessage] = useState('');
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [accessCode, setAccessCode] = useState('');
  const [storageReady, setStorageReady] = useState(false);
  const [routerPassword, setRouterPassword] = useState('');
  const [emailPPPoEInput, setEmailPPPoEInput] = useState('');
  const [passwordPPPoEInput, setPasswordPPPoEInput] = useState('');
  const [wifiName, setWifiName] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [presetLoading, setPresetLoading] = useState(false);
  const [onuLoading, setOnuLoading] = useState(false);
  const [consoleVisible, setConsoleVisible] = useState(true);
  const [lastAction, setLastAction] = useState('');

  const appStateRef = useRef(AppState.currentState);
  const healthRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthAlertShownRef = useRef(false);

  const clearHealthRetryTimer = useCallback(() => {
    if (healthRetryTimerRef.current) {
      clearTimeout(healthRetryTimerRef.current);
      healthRetryTimerRef.current = null;
    }
  }, []);


  useEffect(() => {
    let mounted = true;

    const loadStored = async () => {
      try {
        const [storedBackendUrl, storedCode] = await Promise.all([
          AsyncStorage.getItem(STORAGE_BACKEND_URL_KEY),
          AsyncStorage.getItem(STORAGE_ACCESS_CODE_KEY),
        ]);

        if (!mounted) return;

        if (storedBackendUrl?.trim()) setBackendUrl(storedBackendUrl.trim());
        if (initialCode.trim()) {
          setAccessCode(initialCode.trim());
          await AsyncStorage.setItem(STORAGE_ACCESS_CODE_KEY, initialCode.trim());
        } else if (storedCode?.trim()) {
          setAccessCode(storedCode.trim());
        }
      } finally {
        if (mounted) setStorageReady(true);
      }
    };

    void loadStored();

    return () => {
      mounted = false;
    };
  }, [initialCode]);

  useEffect(() => {
    if (!storageReady) return;
    void AsyncStorage.setItem(STORAGE_BACKEND_URL_KEY, normalizeBackendUrl(backendUrl));
  }, [backendUrl, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    const cleanCode = accessCode.trim();
    if (cleanCode) {
      void AsyncStorage.setItem(STORAGE_ACCESS_CODE_KEY, cleanCode);
    } else {
      void AsyncStorage.removeItem(STORAGE_ACCESS_CODE_KEY);
    }
  }, [accessCode, storageReady]);

  const checkHealth = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    try {
      setHealthState((current) => (current === 'online' ? current : 'checking'));
      setHealthMessage('');

      const response = await fetch(buildUrl(backendUrl, '/health').toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        setHealthState('offline');
        setHealthMessage(`HTTP ${response.status} ao consultar /health.`);
        return false;
      }

      const payload = (await response.json()) as { status?: unknown };
      if (payload?.status === 'ok') {
        setHealthState('online');
        setHealthMessage('');
        return true;
      }

      setHealthState('offline');
      setHealthMessage('O endpoint /health respondeu, mas não confirmou o servidor ativo.');
      return false;
    } catch (error) {
      if (controller.signal.aborted) {
        setHealthState('error');
        setHealthMessage('Tempo limite excedido ao verificar o servidor.');
        return false;
      }

      setHealthState('error');
      setHealthMessage(error instanceof Error ? error.message : 'Erro desconhecido ao verificar o servidor.');
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }, [backendUrl]);

  const {
    status,
    logs,
    browserSession,
    browserFrame,
    browserActive,
    browserStatusLabel,
    currentBrowserStep,
    streamState,
    reconnectNow,
    syncStatus,
  } = useBackendRealtime({
    backendUrl,
    accessCode,
    enabled: healthState === 'online' && storageReady,
  });

  useEffect(() => {
    if (!storageReady) return;
    void checkHealth();
  }, [checkHealth, storageReady]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (!storageReady || nextState !== 'active' || previousState === 'active') {
        return;
      }

      void (async () => {
        const ok = await checkHealth();
        if (ok && accessCode.trim()) {
          await syncStatus('manual');
        }
      })();
    });

    return () => {
      subscription.remove();
    };
  }, [accessCode, checkHealth, storageReady, syncStatus]);

  useEffect(() => {
    if (!storageReady) return;
    if (healthState === 'online' && accessCode.trim()) {
      void syncStatus('manual');
    }
  }, [accessCode, healthState, storageReady, syncStatus]);

  useEffect(() => {
    if (!storageReady) return;

    if (healthState === 'online') {
      healthAlertShownRef.current = false;
      clearHealthRetryTimer();
      return;
    }

    clearHealthRetryTimer();

    if (AppState.currentState !== 'active') {
      return;
    }

    const delay = healthState === 'checking' ? 1000 : 2200;
    healthRetryTimerRef.current = setTimeout(() => {
      void (async () => {
        if (AppState.currentState !== 'active') return;

        const ok = await checkHealth();
        if (ok) {
          healthAlertShownRef.current = false;
          if (accessCode.trim()) {
            await syncStatus('manual');
          }
          return;
        }

        if (!healthAlertShownRef.current && healthState !== 'checking') {
          healthAlertShownRef.current = true;
          Alert.alert(
            'Servidor ainda não respondeu',
            'O app tentou confirmar o backend, mas ele ainda não respondeu. Verifique se o Termux terminou de iniciar e toque em Iniciar novamente.'
          );
        }
      })();
    }, delay);

    return () => {
      clearHealthRetryTimer();
    };
  }, [accessCode, checkHealth, clearHealthRetryTimer, healthState, storageReady, syncStatus]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const ok = await checkHealth();
      if (ok) {
        await syncStatus('manual');
      }
    } finally {
      setRefreshing(false);
    }
  }, [checkHealth, syncStatus]);

  const openTermux = async () => {
    try {
      await IntentLauncher.openApplication('com.termux');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível abrir o Termux.';
      setLastAction(message);
      Alert.alert(
        'Não foi possível abrir o Termux',
        `${message}\n\nVerifique se o Termux está instalado e rebuildou o APK após liberar a visibilidade do pacote.`
      );
    }
  };

  const sendPreset = useCallback(async () => {
    const normalizedWifiName = wifiName.trim();
    const normalizedWifiPassword = normalizeWifiPassword(wifiPassword);
    const normalizedRouterPassword = routerPassword.trim();
    const normalizedEmail = emailPPPoEInput.trim();
    const normalizedPPPoEPassword = passwordPPPoEInput.trim();

    if (!normalizedRouterPassword) {
      Alert.alert('Campo obrigatório', 'Informe a senha do roteador.');
      return;
    }

    if (normalizedWifiName && !isWifiNameValid(normalizedWifiName)) {
      Alert.alert('Nome do Wi-Fi inválido', ASCII_HINT);
      return;
    }

    if (normalizedWifiPassword && !isWifiPasswordValid(normalizedWifiPassword)) {
      Alert.alert(
        'Senha do Wi-Fi inválida',
        'A senha precisa ter pelo menos 8 caracteres ASCII imprimíveis, ou 64 caracteres hexadecimais.'
      );
      return;
    }

    setPresetLoading(true);
    setLastAction('Enviando preset para o backend...');

    try {
      const response = await fetch(buildUrl(backendUrl, '/api/preset', accessCode).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          password: API_PASSWORD,
          preset: true,
          inputPassword: normalizedRouterPassword,
          emailPPPoEInput: normalizedEmail,
          passwordPPPoEInput: normalizedPPPoEPassword,
          wifiName: normalizedWifiName,
          wifiPassword: normalizedWifiPassword,
        }),
      });

      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        throw new Error(stringifyError(payload, `HTTP ${response.status} ao iniciar o preset.`));
      }

      setLastAction(payload?.message || 'Preset enviado com sucesso.');
      await syncStatus('manual');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao iniciar o preset.';
      setLastAction(message);
      Alert.alert('Erro no preset', message);
    } finally {
      setPresetLoading(false);
    }
  }, [accessCode, backendUrl, emailPPPoEInput, passwordPPPoEInput, routerPassword, syncStatus, wifiName, wifiPassword]);

  const sendUpdateOnu = useCallback(async () => {
    setOnuLoading(true);
    setLastAction('Enviando atualização da ONU...');

    try {
      const response = await fetch(buildUrl(backendUrl, '/api/update-onu', accessCode).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          password: API_PASSWORD,
          updateOnu: true,
        }),
      });

      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        throw new Error(stringifyError(payload, `HTTP ${response.status} ao iniciar a atualização da ONU.`));
      }

      setLastAction(payload?.message || 'Atualização da ONU enviada com sucesso.');
      await syncStatus('manual');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao iniciar a atualização da ONU.';
      setLastAction(message);
      Alert.alert('Erro na ONU', message);
    } finally {
      setOnuLoading(false);
    }
  }, [accessCode, backendUrl, syncStatus]);

  const serviceRunning = status?.service === 'running' || Boolean(status?.ok);
  const presetRunning = Boolean(status?.presetRunning);
  const onuRunning = Boolean(status?.onuRunning);
  const browserViewActive = Boolean(browserSession?.active ?? status?.browserView?.active);

  const healthTone: HealthTone =
    healthState === 'online' ? 'good' : healthState === 'checking' ? 'info' : healthState === 'offline' ? 'warn' : 'bad';

  if (healthState !== 'online') {
    const title =
      healthState === 'offline'
        ? 'Servidor não está ativo'
        : healthState === 'error'
          ? 'Erro ao verificar o servidor'
          : 'Verificando servidor...';

    const subtitle =
      healthState === 'checking'
        ? 'Aguardando resposta do endpoint /health.'
        : healthMessage || 'Não foi possível confirmar o servidor ativo.';

    return (
      <View style={styles.fullScreen}>
        <View style={styles.healthCard}>
          <View style={styles.healthIconWrap}>
            <IconSymbol
              name={
                healthState === 'checking'
                  ? 'arrow.clockwise'
                  : healthState === 'online'
                    ? 'checkmark.circle.fill'
                    : 'exclamationmark.triangle.fill'
              }
              size={30}
              color="#fff"
            />
          </View>
          <Text style={styles.healthTitle}>{title}</Text>
          <Text style={styles.healthSubtitle}>{subtitle}</Text>
          <Text style={styles.healthHint}>Backend configurado em {backendUrl}</Text>

          {healthState === 'checking' ? (
            <ActivityIndicator style={styles.spinner} />
          ) : Platform.OS === 'android' ? (
            <Pressable style={styles.healthActionButton} onPress={openTermux}>
              <IconSymbol name="paperplane.fill" size={16} color="#fff" />
              <Text style={styles.healthActionButtonText}>Iniciar</Text>
            </Pressable>
          ) : (
            <Text style={styles.platformNote}>O botão Iniciar está disponível apenas no Android.</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} />}
        keyboardShouldPersistTaps="handled">
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIcon}>
              <IconSymbol name="slider.horizontal.3" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroKicker}>Painel de integração</Text>
              <Text style={styles.heroTitle}>Frontend conectado ao backend</Text>
            </View>
          </View>
          <Text style={styles.heroText}>
            O front escuta o backend em tempo real via SSE, atualiza logs, status e o preview do browser sem polling.
          </Text>
          <View style={styles.chipRow}>
            <Chip label={healthState === 'online' ? 'Servidor online' : 'Servidor instável'} tone={healthTone} />
            <Chip label={serviceRunning ? 'Serviço rodando' : 'Serviço parado'} tone={serviceRunning ? 'good' : 'warn'} />
            <Chip label={browserViewActive ? 'Browser ativo' : 'Browser inativo'} tone={browserViewActive ? 'good' : 'info'} />
          </View>
        </View>

        <View style={styles.card}>
          <SectionTitle icon="Cloud" title="Conexão" subtitle="URL e code ficam salvos localmente até expirar." />
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Backend URL</Text>
            <TextInput
              value={backendUrl}
              onChangeText={setBackendUrl}
              placeholder="http://127.0.0.1:7777"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Código de acesso</Text>
            <TextInput
              value={accessCode}
              onChangeText={setAccessCode}
              placeholder="code=..."
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>
        </View>

        <View style={styles.card}>
          <SectionTitle icon="Gear" title="Preset Huawei" subtitle="Os campos são enviados para /api/preset." />
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Senha do roteador</Text>
            <TextInput
              value={routerPassword}
              onChangeText={setRouterPassword}
              placeholder="Senha do roteador"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={false}
              textContentType="none"
              autoComplete="off"
              style={styles.input}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Login PPPoE</Text>
            <TextInput
              value={emailPPPoEInput}
              onChangeText={setEmailPPPoEInput}
              placeholder="email@exemplo.com"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Senha PPPoE</Text>
            <TextInput
              value={passwordPPPoEInput}
              onChangeText={setPasswordPPPoEInput}
              placeholder="Senha PPPoE"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={false}
              textContentType="none"
              autoComplete="off"
              style={styles.input}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Nome do Wi-Fi</Text>
            <TextInput
              value={wifiName}
              onChangeText={setWifiName}
              placeholder="MinhaRede"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Senha do Wi-Fi</Text>
            <TextInput
              value={wifiPassword}
              onChangeText={setWifiPassword}
              placeholder="Senha Wi-Fi"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={false}
              textContentType="none"
              autoComplete="off"
              style={styles.input}
            />
          </View>

          <View style={styles.buttonRow}>
            <Pressable style={[styles.primaryButton, (presetLoading || onuLoading) && styles.buttonDisabled]} onPress={() => void sendPreset()} disabled={presetLoading || onuLoading}>
              {presetLoading ? <ActivityIndicator color="#fff" /> : <IconSymbol name="paperplane.fill" size={18} color="#fff" />}
              <Text style={styles.primaryButtonText}>Preset Huawei</Text>
            </Pressable>
            <Pressable style={[styles.secondaryButton, (presetLoading || onuLoading) && styles.buttonDisabled]} onPress={() => void sendUpdateOnu()} disabled={presetLoading || onuLoading}>
              {onuLoading ? <ActivityIndicator color="#fff" /> : <IconSymbol name="arrow.clockwise" size={18} color="#fff" />}
              <Text style={styles.primaryButtonText}>Update ONU</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <SectionTitle icon="Check" title="Status do serviço" subtitle="Sem polling: o SSE atualiza o estado em tempo real." />
          <View style={styles.statusGrid}>
            <View style={styles.statusBox}>
              <Text style={styles.statusLabel}>Serviço</Text>
              <Text style={styles.statusValue}>{status?.service || '—'}</Text>
            </View>
            <View style={styles.statusBox}>
              <Text style={styles.statusLabel}>Preset</Text>
              <Text style={styles.statusValue}>{presetRunning ? 'Em execução' : 'Parado'}</Text>
            </View>
            <View style={styles.statusBox}>
              <Text style={styles.statusLabel}>ONU</Text>
              <Text style={styles.statusValue}>{onuRunning ? 'Em execução' : 'Parado'}</Text>
            </View>
            <View style={styles.statusBox}>
              <Text style={styles.statusLabel}>Browser</Text>
              <Text style={styles.statusValue}>{browserViewActive ? 'Ativo' : 'Inativo'}</Text>
            </View>
          </View>

          <View style={styles.statusDetail}>
            <Text style={styles.detailLabel}>Mensagem</Text>
            <Text style={styles.detailValue}>{status?.state?.message || status?.browserView?.label || healthMessage || STATUS_POLL_NOTE}</Text>
          </View>
          <View style={styles.statusDetail}>
            <Text style={styles.detailLabel}>Run ID</Text>
            <Text style={styles.detailValue}>{status?.state?.runId || status?.onuState?.runId || browserSession?.runId || '—'}</Text>
          </View>
          <View style={styles.statusDetail}>
            <Text style={styles.detailLabel}>Início</Text>
            <Text style={styles.detailValue}>{formatDateTime(status?.state?.startedAt || status?.onuState?.startedAt || browserSession?.startedAt)}</Text>
          </View>
          <View style={styles.statusDetail}>
            <Text style={styles.detailLabel}>Finalização</Text>
            <Text style={styles.detailValue}>{formatDateTime(status?.state?.finishedAt || status?.onuState?.finishedAt || browserSession?.finishedAt)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <SectionTitle
            icon="Warning"
            title="Browser ao vivo"
            subtitle="browser-session atualiza o painel e browser-frame troca a imagem."
          />
          <BrowserPreview
            browserFrame={browserFrame}
            browserSession={browserSession}
            browserStatusLabel={browserStatusLabel}
            currentStep={currentBrowserStep}
          />
        </View>

        <View style={styles.card}>
          <View style={styles.consoleHeaderRow}>
            <SectionTitle
              icon="Warning"
              title="Console ao vivo"
              subtitle="Cada evento log é empilhado no momento em que chega."
            />
            <Pressable style={styles.consoleToggle} onPress={() => setConsoleVisible((value) => !value)}>
              <Text style={styles.consoleToggleText}>{consoleVisible ? 'Ocultar' : 'Mostrar'}</Text>
            </Pressable>
          </View>
          {consoleVisible ? <LiveConsole logs={logs} connectionState={streamState.statusStream} /> : null}
        </View>

        <View style={styles.card}>
          <SectionTitle icon="Warning" title="Reconexão e sincronização" subtitle="Ao cair, os streams reabrem e o status é sincronizado de novo." />
          <Text style={styles.detailValue}>
            Estado SSE: status={streamState.statusStream}, browser={streamState.browserStream}
          </Text>
          <Text style={styles.detailValue}>Última sincronização: {formatDateTime(streamState.lastSyncedAt)}</Text>
          <Text style={styles.detailValue}>Último erro: {streamState.lastError || '—'}</Text>
          <Pressable style={styles.retryButton} onPress={() => reconnectNow()}>
            <Text style={styles.retryButtonText}>Forçar reconexão</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <SectionTitle icon="Warning" title="Resposta recente" subtitle="Mostra o último retorno útil do backend." />
          <Text style={styles.consoleText}>{lastAction || healthMessage || 'Nenhuma resposta ainda.'}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>Health: {healthState}</Text>
            <Text style={styles.metaText}>Code: {accessCode.trim() ? 'informado' : 'vazio'}</Text>
          </View>
        </View>

        <View style={styles.footerSpace} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0b1020',
  },
  scrollContent: {
    padding: 16,
    paddingTop: 56,
    gap: 14,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: '#0b1020',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  healthCard: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 28,
    paddingVertical: 28,
    paddingHorizontal: 22,
    backgroundColor: '#111a33',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  healthIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: '#ef4444',
    marginBottom: 16,
  },
  healthTitle: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  healthSubtitle: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  healthHint: {
    color: 'rgba(255,255,255,0.58)',
    marginTop: 14,
    textAlign: 'center',
  },
  spinner: {
    marginTop: 22,
  },
  healthActionButton: {
    alignSelf: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#f97316',
    marginTop: 18,
  },
  healthActionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  platformNote: {
    marginTop: 20,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
  },
  heroCard: {
    borderRadius: 28,
    padding: 18,
    backgroundColor: '#151f3c',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f97316',
  },
  heroKicker: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
  },
  heroText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  chipGood: {
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderColor: 'rgba(34,197,94,0.30)',
  },
  chipWarn: {
    backgroundColor: 'rgba(245,158,11,0.16)',
    borderColor: 'rgba(245,158,11,0.30)',
  },
  chipBad: {
    backgroundColor: 'rgba(239,68,68,0.16)',
    borderColor: 'rgba(239,68,68,0.30)',
  },
  chipInfo: {
    backgroundColor: 'rgba(59,130,246,0.16)',
    borderColor: 'rgba(59,130,246,0.30)',
  },
  chipText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    borderRadius: 24,
    padding: 16,
    backgroundColor: '#111a33',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#334155',
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: 'rgba(255,255,255,0.58)',
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: 'rgba(255,255,255,0.80)',
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: '#ffffff',
    paddingHorizontal: 14,
    fontSize: 15,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryButton: {
    minHeight: 54,
    flexGrow: 1,
    flexBasis: '48%',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#f97316',
    paddingHorizontal: 16,
  },
  secondaryButton: {
    minHeight: 54,
    flexGrow: 1,
    flexBasis: '48%',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#475569',
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statusBox: {
    flexGrow: 1,
    flexBasis: '48%',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  statusLabel: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  statusValue: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  statusDetail: {
    gap: 4,
  },
  detailLabel: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 12,
    fontWeight: '700',
  },
  detailValue: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  consoleText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaText: {
    color: 'rgba(255,255,255,0.60)',
    fontSize: 12,
    fontWeight: '700',
  },
  footerSpace: {
    height: 12,
  },
  consoleHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  consoleToggle: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  consoleToggleText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#f97316',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
});

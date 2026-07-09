import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import {
  ApiStatus,
  BrowserFramePayload,
  BrowserSessionPayload,
  LiveLogEntry,
  RealtimeConnectionState,
  STATUS_TIMEOUT_MS,
  buildUrl,
  stringifyError,
} from '@/lib/api';
import { createEventSource, type EventSourceLike } from '@/lib/sse';
function createLogEntry(level: LiveLogEntry['level'], message: string): LiveLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    level,
    message,
  };
}

export type BrowserFrameViewModel = {
  imageUri: string | null;
  label: string;
  mimeType: string | null;
  rawImage: string | null;
  pageUrl: string | null;
  runId: string | null;
};

export function useBackendRealtime(params: {
  backendUrl: string;
  accessCode: string;
  enabled: boolean;
}) {
  const { backendUrl, accessCode, enabled } = params;
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [logs, setLogs] = useState<LiveLogEntry[]>([]);
  const [browserSession, setBrowserSession] = useState<ApiStatus['browserView'] | null>(null);
  const [browserFrame, setBrowserFrame] = useState<BrowserFrameViewModel>({
    imageUri: null,
    label: '',
    mimeType: null,
    rawImage: null,
    pageUrl: null,
    runId: null,
  });
  const [streamState, setStreamState] = useState<{
    statusStream: RealtimeConnectionState;
    browserStream: RealtimeConnectionState;
    lastError: string | null;
    reconnectAttempt: number;
    lastSyncedAt: string | null;
  }>({
    statusStream: 'idle',
    browserStream: 'idle',
    lastError: null,
    reconnectAttempt: 0,
    lastSyncedAt: null,
  });

  const statusSourceRef = useRef<EventSourceLike | null>(null);
  const browserSourceRef = useRef<EventSourceLike | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const lastConnectKeyRef = useRef<string>('');
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const normalizedCode = accessCode.trim();

  const closeSources = useCallback(() => {
    statusSourceRef.current?.close();
    browserSourceRef.current?.close();
    statusSourceRef.current = null;
    browserSourceRef.current = null;
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearSyncTimer = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);

  const enqueueReconnect = useCallback(
    (reason: string) => {
      if (!enabled || !mountedRef.current) return;
      clearReconnectTimer();
      clearSyncTimer();
      reconnectAttemptRef.current += 1;
      const nextAttempt = reconnectAttemptRef.current;
      const delay = Math.min(15000, 1000 * 2 ** Math.min(nextAttempt - 1, 4));

      setStreamState((current) => ({
        ...current,
        statusStream: current.statusStream === 'open' ? 'reconnecting' : 'error',
        browserStream: current.browserStream === 'open' ? 'reconnecting' : 'error',
        lastError: reason,
        reconnectAttempt: nextAttempt,
      }));

      reconnectTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        openStreams();
      }, delay);
    },
    [clearReconnectTimer, clearSyncTimer, enabled]
  );

  const syncStatus = useCallback(
    async (reason: 'initial' | 'reconnect' | 'manual' | 'app-active') => {
      if (!enabled || !normalizedCode) return null;

      clearSyncTimer();

      const controller = new AbortController();
      syncTimerRef.current = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);

      try {
        const response = await fetch(buildUrl(backendUrl, '/api/status', normalizedCode).toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });

        const payload = (await response.json().catch(() => null)) as ApiStatus | null;
        if (!response.ok) {
          throw new Error(stringifyError(payload, `HTTP ${response.status} ao consultar /api/status.`));
        }

        if (!mountedRef.current) return payload;
        setStatus(payload);
        setStreamState((current) => ({
          ...current,
          lastError: null,
          lastSyncedAt: new Date().toISOString(),
        }));

        if (reason === 'reconnect') {
          setLogs((current) => [
            ...current,
            createLogEntry('info', 'Sincronização de estado concluída após reconexão.'),
          ]);
        }

        return payload;
      } catch (error) {
        if (!mountedRef.current) return null;
        const message = error instanceof Error ? error.message : 'Falha ao consultar /api/status.';
        setStreamState((current) => ({ ...current, lastError: message }));
        return null;
      } finally {
        clearSyncTimer();
      }
    },
    [backendUrl, clearSyncTimer, enabled, normalizedCode]
  );

  const openStreams = useCallback(() => {
    if (!enabled || !normalizedCode) return;

    clearReconnectTimer();
    closeSources();

    const key = `${backendUrl}|${normalizedCode}`;
    lastConnectKeyRef.current = key;

    setStreamState((current) => ({
      ...current,
      statusStream: 'connecting',
      browserStream: 'connecting',
      lastError: null,
    }));

    const statusUrl = buildUrl(backendUrl, '/api/stream', normalizedCode).toString();
    const browserUrl = buildUrl(backendUrl, '/api/browser-stream', normalizedCode).toString();

    const statusSource = createEventSource(statusUrl, {
      withCredentials: Platform.OS === 'web',
    });

    const browserSource = createEventSource(browserUrl, {
      withCredentials: Platform.OS === 'web',
    });

    statusSourceRef.current = statusSource;
    browserSourceRef.current = browserSource;

    statusSource.onopen = () => {
      if (!mountedRef.current) return;
      setStreamState((current) => ({ ...current, statusStream: 'open' }));
    };

    browserSource.onopen = () => {
      if (!mountedRef.current) return;
      setStreamState((current) => ({ ...current, browserStream: 'open' }));
    };

    const handleStreamError = (source: 'status' | 'browser') => (event: unknown) => {
      if (!mountedRef.current) return;
      setStreamState((current) => ({
        ...current,
        statusStream: source === 'status' ? 'error' : current.statusStream,
        browserStream: source === 'browser' ? 'error' : current.browserStream,
      }));
      enqueueReconnect(`${source} stream desconectado.`);
    };

    statusSource.onerror = handleStreamError('status');
    browserSource.onerror = handleStreamError('browser');

    statusSource.addEventListener('log', (event: { data?: string }) => {
      if (!mountedRef.current) return;
      const payload = safeJsonParse(event.data, null) as { timestamp?: string; level?: string; message?: string } | null;
      const message = payload?.message || event.data || '';
      const level = payload?.level === 'error' || payload?.level === 'warn' || payload?.level === 'info' ? payload.level : 'log';
      setLogs((current) => [...current, createLogEntry(level, message)].slice(-300));
    });

    statusSource.addEventListener('status', (event: { data?: string }) => {
      if (!mountedRef.current) return;
      const payload = safeJsonParse(event.data, null) as ApiStatus | null;
      if (!payload) return;
      setStatus(payload);
      setStreamState((current) => ({
        ...current,
        lastError: null,
        lastSyncedAt: new Date().toISOString(),
      }));
    });

    browserSource.addEventListener('browser-session', (event: { data?: string }) => {
      if (!mountedRef.current) return;
      const payload = safeJsonParse(event.data, null) as BrowserSessionPayload | null;
      if (!payload?.browserView) return;
      setBrowserSession(payload.browserView);
    });

    browserSource.addEventListener('browser-frame', (event: { data?: string }) => {
      if (!mountedRef.current) return;
      const payload = safeJsonParse(event.data, null) as BrowserFramePayload | null;
      const frame = payload?.frame;
      const browserView = payload?.browserView;

      if (browserView) {
        setBrowserSession(browserView);
      }

      if (!frame?.image || !frame.mimeType) return;

      setBrowserFrame({
        rawImage: frame.image,
        mimeType: frame.mimeType,
        imageUri: `data:${frame.mimeType};base64,${frame.image}`,
        label: frame.label || browserView?.lastFrameLabel || browserView?.label || 'browser-frame',
        pageUrl: frame.pageUrl || null,
        runId: frame.runId || browserView?.runId || null,
      });
    });

    void syncStatus('initial');
  }, [backendUrl, clearReconnectTimer, closeSources, enabled, enqueueReconnect, normalizedCode, syncStatus]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      clearSyncTimer();
      closeSources();
    };
  }, [clearReconnectTimer, clearSyncTimer, closeSources]);

  useEffect(() => {
    if (!enabled || !normalizedCode) {
      closeSources();
      return;
    }

    const connectKey = `${backendUrl}|${normalizedCode}`;
    if (connectKey !== lastConnectKeyRef.current) {
      reconnectAttemptRef.current = 0;
      setStreamState((current) => ({
        ...current,
        reconnectAttempt: 0,
        lastError: null,
      }));
      openStreams();
    }
  }, [backendUrl, closeSources, enabled, normalizedCode, openStreams]);

  useEffect(() => {
    if (!enabled || !normalizedCode) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'active' && previous !== 'active') {
        void syncStatus('app-active');
        const statusClosed = statusSourceRef.current?.readyState === 2;
        const browserClosed = browserSourceRef.current?.readyState === 2;
        if (statusClosed || browserClosed) {
          openStreams();
        }
      }
    });

    return () => subscription.remove();
  }, [enabled, normalizedCode, openStreams, syncStatus]);

  const currentBrowserStep = useMemo(() => {
    return (
      browserFrame.label ||
      browserSession?.lastFrameLabel ||
      browserSession?.label ||
      status?.browserView?.lastFrameLabel ||
      status?.browserView?.label ||
      'Aguardando execução'
    );
  }, [browserFrame.label, browserSession?.label, browserSession?.lastFrameLabel, status?.browserView?.label, status?.browserView?.lastFrameLabel]);

  const browserActive = Boolean(browserSession?.active ?? status?.browserView?.active);
  const browserStatusLabel = browserSession?.status || status?.browserView?.status || 'idle';

  const reconnectNow = useCallback(() => {
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
    openStreams();
    void syncStatus('manual');
  }, [clearReconnectTimer, openStreams, syncStatus]);

  return {
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
  };
}

function safeJsonParse<T>(value: string | undefined | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

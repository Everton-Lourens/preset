export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:7777';
export const HEALTH_TIMEOUT_MS = 2500;
export const STATUS_TIMEOUT_MS = 5000;
export const API_PASSWORD = '50292230';
export const STORAGE_BACKEND_URL_KEY = 'preset.backendUrl';
export const STORAGE_ACCESS_CODE_KEY = 'preset.accessCode';

export const ASCII_PRINTABLE_REGEX = /^[\x20-\x7E]+$/;
export const WIFI_PASSWORD_REGEX = /^(?:[\x20-\x7E]{8,}|[A-Fa-f0-9]{64})$/;

export type HealthState = 'checking' | 'online' | 'offline' | 'error';

export type ApiStatus = {
  ok?: boolean;
  service?: string;
  host?: string;
  port?: number;
  presetRunning?: boolean;
  onuRunning?: boolean;
  state?: {
    status?: string;
    message?: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    runId?: string | null;
  };
  onuState?: {
    status?: string;
    message?: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    runId?: string | null;
  };
  browserView?: {
    active?: boolean;
    status?: string;
    label?: string;
    runId?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    lastFrameAt?: string | null;
    lastFrameLabel?: string | null;
    reason?: string | null;
  };
};

export type ApiResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  code?: string;
  runId?: string;
  startedAt?: string;
  statusUrl?: string;
};

export type LiveLogLevel = 'log' | 'info' | 'warn' | 'error';

export type LiveLogEntry = {
  id: string;
  timestamp: string;
  level: LiveLogLevel;
  message: string;
};

export type BrowserFramePayload = {
  ok?: boolean;
  timestamp?: string;
  browserView?: ApiStatus['browserView'];
  frame?: {
    label?: string;
    image?: string;
    mimeType?: string;
    runId?: string | null;
    pageUrl?: string;
  };
};

export type BrowserSessionPayload = {
  ok?: boolean;
  browserView?: ApiStatus['browserView'];
};

export type RealtimeConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export function normalizeBackendUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_BACKEND_URL;
  return trimmed.replace(/\/+$/, '');
}

export function buildUrl(baseUrl: string, path: string, code?: string) {
  const cleanCode = code?.trim();

  try {
    const url = new URL(path, `${normalizeBackendUrl(baseUrl)}/`);
    if (cleanCode) {
      url.searchParams.set('code', cleanCode);
    }
    return url;
  } catch {
    const url = new URL(path, `${DEFAULT_BACKEND_URL}/`);
    if (cleanCode) {
      url.searchParams.set('code', cleanCode);
    }
    return url;
  }
}

export function stringifyError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const value = payload as { error?: unknown; message?: unknown; code?: unknown };
    if (typeof value.error === 'string' && value.error.trim()) return value.error;
    if (typeof value.message === 'string' && value.message.trim()) return value.message;
    if (typeof value.code === 'string' && value.code.trim()) return `${fallback} (${value.code})`;
  }
  return fallback;
}

export function isWifiNameValid(value: string) {
  return value.length > 0 && ASCII_PRINTABLE_REGEX.test(value);
}

export function normalizeWifiPassword(value: string) {
  return value.replace(/\s+/g, '');
}

export function isWifiPasswordValid(value: string) {
  return WIFI_PASSWORD_REGEX.test(value);
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

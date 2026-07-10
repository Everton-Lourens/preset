export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:7777';
export const HEALTH_TIMEOUT_MS = 8000;
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


export type HealthProbeMethod = 'GET' | 'HEAD';

export type HealthProbeAttempt = {
  url: string;
  baseUrl: string;
  path: string;
  method: HealthProbeMethod;
  elapsedMs: number;
  status?: number;
  outcome: 'response' | 'network-error' | 'timeout' | 'aborted';
  error?: string;
};

export type HealthProbeResult =
  | {
      online: true;
      message: string;
      attempts: HealthProbeAttempt[];
      successfulAttempt: HealthProbeAttempt;
    }
  | {
      online: false;
      message: string;
      attempts: HealthProbeAttempt[];
    };

const HEALTH_PATH = '/health';
function normalizeFetchError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Falha de conexão.';
}

function makeAttempt(url: string, baseUrl: string, path: string, method: HealthProbeMethod, startedAt: number, extra?: Partial<HealthProbeAttempt>): HealthProbeAttempt {
  return {
    url,
    baseUrl,
    path,
    method,
    elapsedMs: Date.now() - startedAt,
    outcome: extra?.outcome ?? 'response',
    status: extra?.status,
    error: extra?.error,
  };
}

function summarizeFailures(attempts: HealthProbeAttempt[]) {
  const topFailures = attempts.slice(0, 2).map((attempt) => {
    const statusPart = typeof attempt.status === 'number' ? `HTTP ${attempt.status}` : attempt.outcome;
    return `${attempt.method} ${attempt.url} → ${statusPart}${attempt.error ? ` (${attempt.error})` : ''}`;
  });

  if (!topFailures.length) {
    return 'Não foi possível confirmar o servidor ativo.';
  }

  return `Não houve resposta válida após ${attempts.length} tentativas. ${topFailures.join(' | ')}`;
}

async function fetchWithTimeout(url: string, method: HealthProbeMethod, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    return { response, aborted: false as const };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      response: null,
      aborted,
      error,
    } as const;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeBackendHealth(baseUrl: string, options?: { timeoutMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const normalizedBaseUrl = normalizeBackendUrl(baseUrl);
  const attempts: HealthProbeAttempt[] = [];

  const healthUrl = buildUrl(normalizedBaseUrl, HEALTH_PATH).toString();
  console.info(`[health] checking ${healthUrl} (timeout ${timeoutMs}ms)`);

  const startedHealth = Date.now();
  const healthResult = await fetchWithTimeout(healthUrl, 'HEAD', timeoutMs);

  if (healthResult.response) {
    const attempt = makeAttempt(
      healthUrl,
      normalizedBaseUrl,
      HEALTH_PATH,
      'HEAD',
      startedHealth,
      { status: healthResult.response.status, outcome: 'response' }
    );
    attempts.push(attempt);

    return {
      online: true as const,
      successfulAttempt: attempt,
      attempts,
      message: `Servidor ativo em ${attempt.method} ${attempt.url} (${attempt.status} em ${attempt.elapsedMs}ms).`,
    };
  }

  const healthAttempt = makeAttempt(
    healthUrl,
    normalizedBaseUrl,
    HEALTH_PATH,
    'HEAD',
    startedHealth,
    {
      outcome: healthResult.aborted ? 'timeout' : 'network-error',
      error: healthResult.aborted ? 'tempo esgotado' : normalizeFetchError(healthResult.error),
    }
  );
  attempts.push(healthAttempt);

  console.warn(`[health] health endpoint failed ${healthAttempt.method} ${healthAttempt.url}: ${healthAttempt.error}`);

  const mainUrl = normalizeBackendUrl(baseUrl);
  console.info(`[health] fallback checking ${mainUrl} (timeout ${timeoutMs}ms)`);

  const startedMain = Date.now();
  const mainResult = await fetchWithTimeout(mainUrl, 'GET', timeoutMs);

  if (mainResult.response) {
    const attempt = makeAttempt(
      mainUrl,
      normalizedBaseUrl,
      '/',
      'GET',
      startedMain,
      { status: mainResult.response.status, outcome: 'response' }
    );
    attempts.push(attempt);

    return {
      online: true as const,
      successfulAttempt: attempt,
      attempts,
      message: `Servidor ativo em ${attempt.method} ${attempt.url} (${attempt.status} em ${attempt.elapsedMs}ms).`,
    };
  }

  const mainAttempt = makeAttempt(
    mainUrl,
    normalizedBaseUrl,
    '/',
    'GET',
    startedMain,
    {
      outcome: mainResult.aborted ? 'timeout' : 'network-error',
      error: mainResult.aborted ? 'tempo esgotado' : normalizeFetchError(mainResult.error),
    }
  );
  attempts.push(mainAttempt);

  const message = summarizeFailures(attempts);
  console.warn(`[health] offline after ${attempts.length} attempts: ${message}`);

  return {
    online: false as const,
    attempts,
    message,
  };
}

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

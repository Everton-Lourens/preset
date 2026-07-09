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

const HEALTH_BASE_PATHS = ['/health', '/api/status', '/', '/api/health'];
const HEALTH_METHODS: HealthProbeMethod[] = ['GET', 'HEAD'];
const LOCAL_BACKEND_VARIANTS = ['127.0.0.1', 'localhost', '10.0.2.2'];

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isLoopbackHost(hostname: string) {
  const lowered = hostname.toLowerCase();
  return lowered === 'localhost' || lowered === '127.0.0.1' || lowered === '::1';
}

function getBackendPort(baseUrl: string) {
  try {
    const parsed = new URL(normalizeBackendUrl(baseUrl));
    return parsed.port ? `:${parsed.port}` : '';
  } catch {
    return ':7777';
  }
}

function buildHealthBases(baseUrl: string) {
  const normalized = normalizeBackendUrl(baseUrl);
  const fallbacks = new Set<string>([normalized]);

  try {
    const parsed = new URL(normalized);
    const port = parsed.port ? `:${parsed.port}` : '';
    const protocol = parsed.protocol || 'http:';
    const hostname = parsed.hostname;

    if (isLoopbackHost(hostname)) {
      for (const host of LOCAL_BACKEND_VARIANTS) {
        fallbacks.add(`${protocol}//${host}${port}`);
      }
    }
  } catch {
    const port = getBackendPort(normalized);
    for (const host of LOCAL_BACKEND_VARIANTS) {
      fallbacks.add(`http://${host}${port}`);
    }
  }

  return uniqueStrings([...fallbacks]);
}

function buildHealthCandidates(baseUrl: string) {
  const bases = buildHealthBases(baseUrl);
  const candidates: Array<{ baseUrl: string; path: string; method: HealthProbeMethod }> = [];

  for (const base of bases) {
    for (const path of HEALTH_BASE_PATHS) {
      for (const method of HEALTH_METHODS) {
        candidates.push({ baseUrl: base, path, method });
      }
    }
  }

  return candidates;
}

function normalizeFetchError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Falha de conexão.';
}

function makeAttempt(candidate: { baseUrl: string; path: string; method: HealthProbeMethod }) {
  return {
    ...candidate,
    url: buildUrl(candidate.baseUrl, candidate.path).toString(),
  };
}

function summarizeFailures(attempts: HealthProbeAttempt[]) {
  const topFailures = attempts.slice(0, 4).map((attempt) => {
    const statusPart = typeof attempt.status === 'number' ? `HTTP ${attempt.status}` : attempt.outcome;
    return `${attempt.method} ${attempt.baseUrl}${attempt.path} → ${statusPart}${attempt.error ? ` (${attempt.error})` : ''}`;
  });

  if (!topFailures.length) {
    return 'Não foi possível confirmar o servidor ativo.';
  }

  const suffix = attempts.length > topFailures.length ? ` (+${attempts.length - topFailures.length} outras tentativas)` : '';
  return `Não houve resposta válida após ${attempts.length} tentativas. ${topFailures.join(' | ')}${suffix}`;
}

export async function probeBackendHealth(baseUrl: string, options?: { timeoutMs?: number; rounds?: number }) {
  const timeoutMs = options?.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const rounds = Math.max(1, options?.rounds ?? 3);
  const allAttempts: HealthProbeAttempt[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const candidates = buildHealthCandidates(baseUrl);
    const controllers = candidates.map(() => new AbortController());

    const roundResult = await new Promise<{ online: true; successfulAttempt: HealthProbeAttempt; attempts: HealthProbeAttempt[] } | null>(
      (resolve) => {
        let settled = false;
        let completedCount = 0;

        const markCompleted = (attempt: HealthProbeAttempt) => {
          allAttempts.push(attempt);
          completedCount += 1;
          if (!settled && completedCount >= candidates.length) {
            settled = true;
            resolve(null);
          }
        };

        candidates.forEach((candidate, index) => {
          const { baseUrl: candidateBaseUrl, path, method } = candidate;
          const url = makeAttempt(candidate);
          const controller = controllers[index];
          const startedAt = Date.now();

          console.info(
            `[health] round ${round}/${rounds} ${method} ${url.url} (timeout ${timeoutMs}ms)`
          );

          const timer = setTimeout(() => {
            controller.abort();
          }, timeoutMs);

          fetch(url.url, {
            method,
            signal: controller.signal,
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          })
            .then((response) => {
              const attempt: HealthProbeAttempt = {
                url: url.url,
                baseUrl: candidateBaseUrl,
                path,
                method,
                elapsedMs: Date.now() - startedAt,
                status: response.status,
                outcome: 'response',
              };

              if (settled) {
                console.info(
                  `[health] ignored late response ${method} ${url.url} HTTP ${response.status} in ${attempt.elapsedMs}ms`
                );
                return;
              }

              settled = true;
              controllers.forEach((otherController, otherIndex) => {
                if (otherIndex !== index) {
                  otherController.abort();
                }
              });

              clearTimeout(timer);
              allAttempts.push(attempt);

              console.info(
                `[health] online via ${method} ${url.url} HTTP ${response.status} in ${attempt.elapsedMs}ms`
              );
              resolve({ online: true, successfulAttempt: attempt, attempts: [...allAttempts] });
            })
            .catch((error) => {
              const elapsedMs = Date.now() - startedAt;
              const aborted = controller.signal.aborted;
              const attempt: HealthProbeAttempt = {
                url: url.url,
                baseUrl: candidateBaseUrl,
                path,
                method,
                elapsedMs,
                outcome: aborted ? 'timeout' : 'network-error',
                error: aborted ? 'tempo esgotado' : normalizeFetchError(error),
              };

              clearTimeout(timer);

              if (settled) {
                console.info(
                  `[health] ignored late failure ${method} ${url.url} after ${elapsedMs}ms: ${attempt.error}`
                );
                return;
              }

              console.warn(
                `[health] failure ${method} ${url.url} after ${elapsedMs}ms: ${attempt.error}`
              );
              markCompleted(attempt);
            });
        });
      }
    );

    if (roundResult) {
      return {
        online: true as const,
        successfulAttempt: roundResult.successfulAttempt,
        attempts: roundResult.attempts,
        message: `Servidor ativo em ${roundResult.successfulAttempt.method} ${roundResult.successfulAttempt.url} (${roundResult.successfulAttempt.status} em ${roundResult.successfulAttempt.elapsedMs}ms).`,
      };
    }

    if (round < rounds) {
      await new Promise((resolve) => setTimeout(resolve, 250 * round));
    }
  }

  const message = summarizeFailures(allAttempts);
  console.warn(`[health] offline after ${allAttempts.length} attempts: ${message}`);

  return {
    online: false as const,
    attempts: allAttempts,
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

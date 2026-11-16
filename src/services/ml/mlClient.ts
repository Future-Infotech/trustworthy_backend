import { env } from '../../config/env';
import { logger } from '../../config/logger';

/** Extra time on top of the sandbox limit for transport and result serialisation. */
const TRANSPORT_GRACE_SECONDS = 20;

export class MlServiceError extends Error {
  constructor(
    public readonly code: string,
    /** Message safe to show to end users. */
    public readonly userMessage: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(userMessage);
    this.name = 'MlServiceError';
  }
}

const USER_MESSAGES: Record<string, string> = {
  JOB_TIMEOUT: 'The experiment exceeded its time limit. Try a smaller dataset or simpler settings.',
  JOB_RESOURCE_EXCEEDED: 'The experiment exceeded its memory or CPU limit. Try a smaller dataset or simpler settings.',
  SANDBOX_BUSY: 'All experiment workers are busy. Please retry shortly.',
  JOB_FAILED: 'The experiment failed unexpectedly. The error has been logged.',
  VALIDATION_ERROR: 'The experiment parameters were rejected by the ML service.',
};

export interface JobResponse<T> {
  job: string;
  durationMs: number;
  result: T;
}

export interface AlgorithmParam {
  name: string;
  kind: 'int' | 'float' | 'choice';
  default: unknown;
  description: string;
  minimum: number | null;
  maximum: number | null;
  choices: unknown[];
  nullable: boolean;
}

export interface AlgorithmInfo {
  key: string;
  label: string;
  description: string;
  interpretability: 'high' | 'medium' | 'low';
  params: AlgorithmParam[];
}

async function request<T>(path: string, init: RequestInit & { timeoutMs: number; requestId?: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.ML_SERVICE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': env.ML_SERVICE_TOKEN,
        ...(init.requestId ? { 'X-Request-Id': init.requestId } : {}),
      },
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    logger.warn({ err, path }, 'ML service request failed');
    throw new MlServiceError(
      timedOut ? 'ML_TIMEOUT' : 'ML_UNAVAILABLE',
      timedOut ? USER_MESSAGES.JOB_TIMEOUT : 'The ML service is unavailable. Please retry later.',
    );
  }
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    const code = body?.error?.code ?? 'ML_ERROR';
    const message = body?.error?.message ?? `ML service responded ${res.status}`;
    logger.warn({ path, status: res.status, code, message }, 'ML job rejected');
    // Input errors carry messages written for end users (e.g. "Target column 'x' not found").
    const details = body?.error?.details;
    const userMessage =
      code === 'JOB_INVALID_INPUT'
        ? message
        : code === 'VALIDATION_ERROR' && Array.isArray(details) && details.length
          ? details.map((d: { message: string }) => d.message).join('; ')
          : (USER_MESSAGES[code] ?? 'The ML service could not complete the request.');
    throw new MlServiceError(code, userMessage, res.status, details);
  }
  return body as T;
}

let algorithmCache: { at: number; data: AlgorithmInfo[] } | null = null;

export const mlClient = {
  runJob<T = Record<string, unknown>>(name: string, params: unknown, opts: { timeoutSeconds: number; requestId?: string }) {
    return request<JobResponse<T>>(`/ml/jobs/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ params, timeoutSeconds: opts.timeoutSeconds }),
      timeoutMs: (opts.timeoutSeconds + TRANSPORT_GRACE_SECONDS) * 1000,
      requestId: opts.requestId,
    });
  },

  async algorithms(): Promise<AlgorithmInfo[]> {
    if (algorithmCache && Date.now() - algorithmCache.at < 10 * 60_000) return algorithmCache.data;
    const { algorithms } = await request<{ algorithms: AlgorithmInfo[] }>('/ml/algorithms', { method: 'GET', timeoutMs: 5000 });
    algorithmCache = { at: Date.now(), data: algorithms };
    return algorithms;
  },
};

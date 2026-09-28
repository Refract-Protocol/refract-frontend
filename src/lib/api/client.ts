/**
 * Thin fetch wrapper for the Refract backend (see refract-backend/src/routes/*.ts
 * for the source of truth on these shapes). Defaults to a local dev server;
 * override with NEXT_PUBLIC_API_URL in production.
 *
 * The backend is not always running in this environment, so every call site
 * that uses this client is expected to catch `ApiUnreachableError` and fall
 * back to a clearly-labeled fixture — see src/lib/fixtures/.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001/api/v1";

/** Base class for any non-2xx response from the Refract API. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

/** 4xx — the request itself was rejected; the user should fix their input. Never retried. */
export class ValidationError extends ApiError {
  constructor(message: string, status: number, details?: unknown) {
    super(message, status, details);
    this.name = "ValidationError";
  }

  /** The offending field, if the backend's `details` payload identifies one. */
  get field(): string | undefined {
    const d = this.details as { field?: unknown; details?: { field?: unknown } | { path?: unknown[] }[] } | null;
    if (typeof d?.field === "string") return d.field;
    const inner = d?.details;
    if (inner && !Array.isArray(inner) && typeof inner.field === "string") return inner.field;
    if (Array.isArray(inner) && Array.isArray(inner[0]?.path)) return String(inner[0].path[0]);
    return undefined;
  }
}

/** 5xx — the backend failed; retrying shortly may succeed. */
export class ServerError extends ApiError {
  constructor(message: string, status: number, details?: unknown) {
    super(message, status, details);
    this.name = "ServerError";
  }
}

/** The request exceeded `REQUEST_TIMEOUT_MS` without a response. */
export class TimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Refract API did not respond within ${timeoutMs / 1000}s`);
    this.name = "TimeoutError";
  }
}

export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super("Refract API is unreachable");
    this.name = "ApiUnreachableError";
    this.cause = cause;
  }
}

/** Errors worth retrying (and, for read hooks, falling back to fixtures on). */
export function isTransientError(err: unknown): boolean {
  return err instanceof ServerError || err instanceof TimeoutError || err instanceof ApiUnreachableError;
}

/** User-facing message tailored to the error class. */
export function describeApiError(err: unknown, fallback: string): string {
  if (err instanceof ValidationError) {
    return err.field ? `Check "${err.field}": ${err.message}` : `Check your input: ${err.message}`;
  }
  if (err instanceof ServerError) return "The Refract API hit a server error. Please try again in a moment.";
  if (err instanceof TimeoutError) return "The Refract API took too long to respond. Please try again shortly.";
  return err instanceof Error ? err.message : fallback;
}

export const REQUEST_TIMEOUT_MS = 15_000;

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * GET requests are retried on 5xx/timeout (see `retryOnTransient`) before
 * surfacing the error; mutations are never retried automatically.
 */
export function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if ((opts.method ?? "GET") !== "GET") return requestOnce<T>(path, opts);
  return retryOnTransient(() => requestOnce<T>(path, opts), { signal: opts.signal });
}

async function requestOnce<T>(path: string, opts: RequestOptions): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  // Our own controller so a timeout is distinguishable from a caller abort.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  opts.signal?.addEventListener("abort", onCallerAbort);

  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}${path}`, {
        method: opts.method ?? "GET",
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw new TimeoutError(timeoutMs);
      throw new ApiUnreachableError(err);
    }

    const isJson = res.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await res.json().catch(() => null) : null;

    if (!res.ok) {
      const message = payload?.error ?? res.statusText;
      if (res.status >= 500) throw new ServerError(message, res.status, payload);
      if (res.status >= 400) throw new ValidationError(message, res.status, payload);
      throw new ApiError(message, res.status, payload);
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * Retries `fn` on 5xx and timeout failures with exponential backoff. 4xx
 * errors, unreachable-API errors (so offline fixture fallback stays instant)
 * and caller aborts are rethrown immediately. Intended for read-only GETs.
 */
export async function retryOnTransient<T>(
  fn: () => Promise<T>,
  { retries = 2, baseDelayMs = 500, signal }: { retries?: number; baseDelayMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof ServerError || err instanceof TimeoutError;
      if (attempt >= retries || signal?.aborted || !retryable) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      if (signal?.aborted) throw err;
    }
  }
}

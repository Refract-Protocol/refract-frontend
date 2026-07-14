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

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super("Refract API is unreachable");
    this.name = "ApiUnreachableError";
    this.cause = cause;
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: opts.method ?? "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    throw new ApiUnreachableError(err);
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(payload?.error ?? res.statusText, res.status, payload);
  }
  return payload as T;
}

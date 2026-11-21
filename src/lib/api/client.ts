export interface ApiErrorEnvelope {
  code?: string;
  message?: string;
}

/** Error thrown for non-2xx API responses, preserving the server error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseErrorBody(response: Response): Promise<ApiErrorEnvelope | null> {
  try {
    const body = await response.json();
    if (body && typeof body === "object") {
      return body as ApiErrorEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const envelope = await parseErrorBody(response);
  const statusText = response.statusText || `HTTP ${response.status}`;
  const code = envelope?.code ?? statusText;
  const message = envelope?.message ?? statusText;
  return new ApiError(response.status, code, message);
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response;
}

export async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, init);
  return (await response.json()) as T;
}

export class ApiError extends Error {
  status?: number;
  code?: string;
  cause?: unknown;

  constructor(
    message: string,
    options: { status?: number; code?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.cause = options.cause;
  }
}

export interface RequestOptions extends RequestInit {
  baseUrl?: string;
}

const DEFAULT_BASE_URL = '/api';

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { baseUrl = DEFAULT_BASE_URL, headers, ...rest } = options;
  const url = `${baseUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  } catch (cause) {
    throw new ApiError(
      `Network request to ${url} failed`,
      { code: 'NETWORK_ERROR', cause },
    );
  }

  if (!response.ok) {
    let message = `Request to ${url} failed with status ${response.status}`;
    let code: string | undefined;
    try {
      const body = await response.json();
      if (body && typeof body === 'object') {
        if (typeof body.message === 'string') message = body.message;
        if (typeof body.code === 'string') code = body.code;
      }
    } catch {
      // Ignore body parse failures; keep the human-readable default message.
    }
    throw new ApiError(message, { status: response.status, code });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new ApiError(
      `Failed to parse response from ${url}`,
      { status: response.status, code: 'PARSE_ERROR', cause },
    );
  }
}

export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>(path, { ...options, method: 'GET' });
  },
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>(path, { ...options, method: 'DELETE' });
  },
};

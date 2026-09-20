const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const STORAGE_KEY = 'peshani_admin_tokens';

function readTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

function writeTokens(tokens: Tokens | null) {
  try {
    if (tokens) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (private browsing, etc.) - session just won't persist across reloads.
  }
}

let refreshInFlight: Promise<Tokens | null> | null = null;

async function refreshTokens(): Promise<Tokens | null> {
  const current = readTokens();
  if (!current) return null;

  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  if (!res.ok) {
    writeTokens(null);
    return null;
  }
  const tokens: Tokens = await res.json();
  writeTokens(tokens);
  return tokens;
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const tokens = readTokens();
  // FormData must NOT get an explicit Content-Type - the browser sets its own
  // multipart boundary. Forcing 'application/json' here would corrupt any
  // file upload (see apiClient.postForm).
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && retry && tokens) {
    refreshInFlight = refreshInFlight ?? refreshTokens();
    const refreshed = await refreshInFlight;
    refreshInFlight = null;
    if (refreshed) {
      return request<T>(path, options, false);
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.message ?? 'Request failed');
  }
  return body as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', body: formData }),
};

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Fetches a binary file (e.g. a CSV export) with the same Bearer-token +
 * refresh-on-401 handling as `apiClient`. This app authenticates via a
 * Bearer token in localStorage rather than a cookie, so a plain `<a href>`
 * link would not carry auth - callers must fetch the blob here and trigger
 * a client-side download themselves.
 */
export async function downloadFile(path: string, retry = true): Promise<{ blob: Blob; filename: string | null }> {
  const tokens = readTokens();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {},
  });

  if (res.status === 401 && retry && tokens) {
    refreshInFlight = refreshInFlight ?? refreshTokens();
    const refreshed = await refreshInFlight;
    refreshInFlight = null;
    if (refreshed) {
      return downloadFile(path, false);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? 'Export failed');
  }

  const blob = await res.blob();
  const filename = parseFilenameFromContentDisposition(res.headers.get('Content-Disposition'));
  return { blob, filename };
}

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.message ?? 'Login failed');
  }
  writeTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
}

export async function logout(): Promise<void> {
  const tokens = readTokens();
  writeTokens(null);
  if (tokens) {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    }).catch(() => undefined);
  }
}

export function hasStoredSession(): boolean {
  return readTokens() !== null;
}

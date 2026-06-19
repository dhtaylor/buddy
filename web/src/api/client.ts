/**
 * Typed fetch helper for the Buddy API.
 *
 * - Always sends cookies (credentials: 'include') so the session cookie rides along.
 * - Unwraps the `{ data: T }` envelope and returns `T`.
 * - Throws `ApiClientError` (with code + message) on non-2xx, parsed from the
 *   `{ error: { code, message } }` envelope.
 *
 * Feature agents: use `api.get/post/put/del` from their `web/src/api/<feature>.ts`
 * hooks. Do NOT call fetch directly.
 */

export class ApiClientError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const BASE = '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON response
    }
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? 'error', err?.message ?? res.statusText);
  }

  return (json as { data: T }).data;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

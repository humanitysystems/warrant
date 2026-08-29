export const DEFAULT_ADMIN_URL = 'http://127.0.0.1:8787';

export type GatewayError = Error & { status: number };

export function gatewayError(message: string, status: number): GatewayError {
  return Object.assign(new Error(message), { status });
}

export class AdminClient {
  constructor(private readonly baseUrl: string) {}

  async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const detail =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `Request failed with status ${response.status}`;
      throw gatewayError(detail, response.status);
    }
    return body;
  }
}

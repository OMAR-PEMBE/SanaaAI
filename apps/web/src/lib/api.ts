export type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: { fields?: Record<string, string> } };
};

export class ApiClientError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const TOKEN_KEY = 'sanaaai.accessToken';

export function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event('sanaaai-session'));
}

export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/create/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard';
  }
  return value;
}

export function toolPath(toolType: string): string {
  if (toolType === 'text_to_video') return '/create/text-to-video';
  if (toolType === 'image_to_video') return '/create/image-to-video';
  return '/create/image';
}

export function toolLabel(toolType: string): string {
  if (toolType === 'text_to_video') return 'Text to Video';
  if (toolType === 'image_to_video') return 'Image to Video';
  return 'AI Image';
}

export function statusLabel(status: string): string {
  if (status === 'pending' || status === 'submitted') return 'Starting';
  if (status === 'processing' || status === 'needs_reconciliation') return 'Creating';
  if (status === 'completed') return 'Ready';
  if (status === 'failed') return 'Failed';
  return 'In progress';
}

export function visibilityLabel(visibility: string): string {
  if (visibility === 'published') return 'On Explore';
  if (visibility === 'rejected') return 'Hidden';
  return 'Private';
}

const emailPattern = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;

export function isValidEmail(value: string): boolean {
  return emailPattern.test(value.trim());
}

export function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString('en-TZ')}`;
}

export function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers, body });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!response.ok) {
    const error = payload?.error;
    if (response.status === 401 && token && !path.startsWith('/v1/auth/login')) setToken(null);
    throw new ApiClientError(
      response.status,
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? 'Something went wrong.',
      error?.details?.fields,
    );
  }
  return payload as T;
}

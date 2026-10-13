import { createHmac, timingSafeEqual } from 'node:crypto';

export function signMediaUrl(input: {
  baseUrl: string;
  secret: string;
  kind: 'asset' | 'upload';
  id: string;
  ttlSeconds: number;
  nowMs?: number;
}): { url: string; expiresAt: string } {
  const exp = Math.floor((input.nowMs ?? Date.now()) / 1000) + input.ttlSeconds;
  const sig = createHmac('sha256', input.secret).update(`${input.kind}.${input.id}.${exp}`).digest('base64url');
  const root = input.baseUrl.replace(/\/$/, '');
  return {
    url: `${root}/v1/media/${input.kind}/${input.id}?exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyMediaSignature(input: {
  secret: string;
  kind: string;
  id: string;
  exp: string | undefined;
  sig: string | undefined;
  nowMs?: number;
}): boolean {
  if (!input.exp || !input.sig || !input.secret) return false;
  const exp = Number(input.exp);
  if (!Number.isFinite(exp) || exp < Math.floor((input.nowMs ?? Date.now()) / 1000)) return false;
  const expected = createHmac('sha256', input.secret)
    .update(`${input.kind}.${input.id}.${exp}`)
    .digest('base64url');
  const left = Buffer.from(expected);
  const right = Buffer.from(input.sig);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSoulBody, createGenerationProvider } from './generation.js';
import { signMediaUrl, verifyMediaSignature } from './media.js';
import { sanitizeProviderPayload, toSnippePhone } from './phone.js';
import { createPaymentGateway, signSnippeWebhook, snippeIdempotencyKey, verifySnippeWebhook } from './snippe.js';
import { assertPublicHttpsUrl } from './ssrf.js';

test('Snippe idempotency keys stay within 30 characters', () => {
  const key = snippeIdempotencyKey('123e4567-e89b-12d3-a456-426614174000');
  assert.equal(key.length <= 30, true);
  assert.equal(key.includes('-'), false);
});

test('Snippe signatures accept the raw body and reject tampering or stale time', () => {
  const body = Buffer.from('{"event":"payment.completed"}');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signSnippeWebhook(body, timestamp, 'secret');
  assert.equal(verifySnippeWebhook(body, timestamp, signature, 'secret'), true);
  assert.equal(verifySnippeWebhook(Buffer.from('{"event":"nope"}'), timestamp, signature, 'secret'), false);
  assert.equal(verifySnippeWebhook(body, '100', signature, 'secret'), false);
});

test('phone numbers become the 255 form and stored payloads hide them', () => {
  assert.equal(toSnippePhone('+255712345678'), '255712345678');
  assert.equal(toSnippePhone('0712345678'), '255712345678');
  assert.equal(toSnippePhone('123'), null);
  const sanitized = sanitizeProviderPayload({
    phone_number: '255712345678',
    signature: 'hide-me',
    nested: { msisdn: '255700000001' },
  }) as { phone_number: string; signature?: string; nested: { msisdn: string } };
  assert.equal(sanitized.phone_number, '••78');
  assert.equal(sanitized.signature, undefined);
  assert.equal(sanitized.nested.msisdn, '••01');
});

test('private and local provider URLs are rejected', async () => {
  await assert.rejects(() => assertPublicHttpsUrl('http://1.1.1.1/file'));
  await assert.rejects(() => assertPublicHttpsUrl('https://127.0.0.1/file'));
  await assert.rejects(() => assertPublicHttpsUrl('https://169.254.169.254/latest'));
  await assert.rejects(() => assertPublicHttpsUrl('https://localhost/file'));
  await assert.rejects(() => assertPublicHttpsUrl('https://[::1]/file'));
  const allowed = await assertPublicHttpsUrl('https://1.1.1.1/file');
  assert.equal(allowed.hostname, '1.1.1.1');
});

test('Soul 2 requests ask for one image and a verified ratio', () => {
  const body = buildSoulBody({
    generationId: 'g',
    toolType: 'ai_image',
    prompt: 'A studio bottle',
    aspectRatio: '1:1',
    durationSeconds: null,
    sourceImageUrl: null,
    modelUsed: 'soul-2',
  });
  assert.equal(body.batch_size, 1);
  assert.equal(body.aspect_ratio, '1:1');
  assert.equal(body.resolution, '720p');
});

test('media signatures expire', () => {
  const signed = signMediaUrl({
    baseUrl: 'http://localhost:4000',
    secret: 'secret',
    kind: 'asset',
    id: 'abc',
    ttlSeconds: 10,
    nowMs: 1_700_000_000_000,
  });
  const exp = new URL(signed.url).searchParams.get('exp') ?? '';
  const sig = new URL(signed.url).searchParams.get('sig') ?? '';
  assert.equal(
    verifyMediaSignature({ secret: 'secret', kind: 'asset', id: 'abc', exp, sig, nowMs: 1_700_000_000_000 }),
    true,
  );
  assert.equal(
    verifyMediaSignature({
      secret: 'secret',
      kind: 'asset',
      id: 'abc',
      exp,
      sig,
      nowMs: 1_700_000_000_000 + 20_000,
    }),
    false,
  );
});

test('production refuses the fake providers', () => {
  assert.throws(() => createPaymentGateway({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'fake' }));
  assert.throws(() => createGenerationProvider({ NODE_ENV: 'production', GENERATION_PROVIDER: 'fake' }));
});

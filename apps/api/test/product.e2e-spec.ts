import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { processGenerationJob } from '@sanaaai/generation';
import { createGenerationProvider, createObjectStorage, signSnippeWebhook } from '@sanaaai/providers';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/core/prisma.service.js';

const IMAGE = '20000000-0000-4000-8000-000000000001';
const IMAGE_TO_VIDEO = '20000000-0000-4000-8000-000000000004';
const PACKAGE = '10000000-0000-4000-8000-000000000001';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const OWNER = 'postgresql://user:password@localhost:5432/sanaaai';

function ensureEnv(): void {
  process.env.PASSWORD_HASH_COST = '10';
  process.env.JWT_SECRET ??= 'local-dev-jwt-secret-not-for-production';
  process.env.JWT_ACCESS_TOKEN_TTL ??= '15m';
  process.env.DATABASE_URL ??= 'postgresql://sanaaai_app:sanaaai_app@localhost:5432/sanaaai';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.PAYMENT_PROVIDER = 'fake';
  process.env.GENERATION_PROVIDER = 'fake';
  process.env.SNIPPE_WEBHOOK_SECRET ??= 'local-dev-webhook-secret';
  process.env.API_BASE_URL ??= 'http://localhost:4000';
  process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
  process.env.FRONTEND_URL ??= 'http://localhost:3000';
  process.env.STORAGE_LOCAL_DIR ??= '../../storage';
  process.env.RATE_LIMIT_REGISTER_PER_MINUTE = '1000';
  process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';
  process.env.RATE_LIMIT_FORGOT_PER_MINUTE = '1000';
  process.env.RATE_LIMIT_GENERATION_PER_HOUR = '1000';
  process.env.RATE_LIMIT_WEBHOOK_PER_MINUTE = '1000';
}

describe('product', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ensureEnv();
    const owner = new pg.Client({ connectionString: OWNER });
    await owner.connect();
    try {
      await owner.query(
        `UPDATE generation_configurations SET is_active = true, cost_credits = CASE WHEN id = $1 THEN 2 ELSE cost_credits END`,
        [IMAGE],
      );
      const hash = await bcrypt.hash('local-admin-pass', 10);
      const updated = await owner.query(
        `UPDATE users SET password_hash = $1, role = 'admin', status = 'active' WHERE email = 'admin@localhost.sanaaai'`,
        [hash],
      );
      if (updated.rowCount !== 1) throw new Error('Seed the local admin before product tests.');
    } finally {
      await owner.end();
    }

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  function http() {
    return request(app.getHttpServer());
  }

  async function register(label: string) {
    const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    const response = await http().post('/v1/auth/register').send({
      fullName: label,
      email,
      password: 'password-ok',
    });
    expect(response.status).toBe(201);
    return {
      email,
      id: response.body.data.user.id as string,
      token: response.body.data.accessToken as string,
    };
  }

  async function loginAdmin() {
    const response = await http().post('/v1/auth/login').send({
      email: 'admin@localhost.sanaaai',
      password: 'local-admin-pass',
    });
    expect(response.status).toBe(200);
    return response.body.data.accessToken as string;
  }

  async function credit(adminToken: string, userId: string, amountCredits: number) {
    const response = await http()
      .post(`/v1/admin/users/${userId}/credit-adjustments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amountCredits, reason: 'Test balance', confirm: amountCredits >= 1000 });
    expect(response.status).toBe(201);
  }

  async function finish(id: string) {
    await processGenerationJob(id, {
      prisma,
      provider: createGenerationProvider({ GENERATION_PROVIDER: 'fake', NODE_ENV: 'test' }),
      storage: createObjectStorage({ STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR }),
    });
  }

  async function walletOf(token: string) {
    const response = await http().get('/v1/wallet').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return response.body.data as { balanceCredits: number; heldCredits: number };
  }

  it('registers a zero wallet and rejects a duplicate email', async () => {
    const user = await register('Wallet');
    const wallet = await walletOf(user.token);
    expect(wallet).toEqual({ balanceCredits: 0, heldCredits: 0 });
    const duplicate = await http().post('/v1/auth/register').send({
      fullName: 'Wallet',
      email: user.email,
      password: 'password-ok',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('uses the same login error for an unknown email and a wrong password', async () => {
    const user = await register('Login');
    const unknown = await http().post('/v1/auth/login').send({ email: 'missing@example.com', password: 'password-ok' });
    const wrong = await http().post('/v1/auth/login').send({ email: user.email, password: 'not-the-password' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body.error.message).toBe('Invalid email or password.');
  });

  it('logs out the current token and accepts a reset token', async () => {
    const user = await register('Session');
    const loggedOut = await http().post('/v1/auth/logout').set('Authorization', `Bearer ${user.token}`);
    expect(loggedOut.status).toBe(204);
    const me = await http().get('/v1/auth/me').set('Authorization', `Bearer ${user.token}`);
    expect(me.status).toBe(401);
    const token = 'reset-token-value-with-enough-length-123456';
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: createHash('sha256').update(token).digest('hex'),
        passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const reset = await http().post('/v1/auth/password/reset').send({ token, newPassword: 'password-ok-2' });
    expect(reset.status).toBe(200);
    const again = await http().post('/v1/auth/login').send({ email: user.email, password: 'password-ok-2' });
    expect(again.status).toBe(200);
  });

  it('lists public prices and refuses a generation without credits before any hold', async () => {
    const packages = await http().get('/v1/wallet/packages');
    expect(packages.status).toBe(200);
    expect(packages.body.data.some((row: { id: string }) => row.id === PACKAGE)).toBe(true);
    const configs = await http().get('/v1/generations/configurations');
    expect(configs.status).toBe(200);
    const image = configs.body.data.find((row: { id: string }) => row.id === IMAGE);
    expect(image.costCredits).toBe(2);
    expect(image.aspectRatios).toContain('1:1');
    const user = await register('Broke');
    const denied = await http()
      .post('/v1/generations')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ generationConfigurationId: IMAGE, input: { prompt: 'a cup', aspectRatio: '1:1' } });
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(await prisma.generation.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.walletTransaction.count({ where: { userId: user.id } })).toBe(0);
  });

  it('stops concurrent holds from overspending and settles each success once', async () => {
    const admin = await loginAdmin();
    const user = await register('Race');
    await credit(admin, user.id, 10);
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        http()
          .post('/v1/generations')
          .set('Authorization', `Bearer ${user.token}`)
          .send({
            generationConfigurationId: IMAGE,
            input: { prompt: `cup ${index}`, aspectRatio: '1:1' },
          }),
      ),
    );
    const created = responses.filter((response) => response.status === 202);
    const denied = responses.filter((response) => response.status === 409);
    expect(created).toHaveLength(5);
    expect(denied).toHaveLength(1);
    let held = await walletOf(user.token);
    expect(held).toEqual({ balanceCredits: 10, heldCredits: 10 });
    for (const response of created) {
      await finish(response.body.data.id as string);
      await finish(response.body.data.id as string);
    }
    held = await walletOf(user.token);
    expect(held).toEqual({ balanceCredits: 0, heldCredits: 0 });
    expect(await prisma.walletTransaction.count({ where: { userId: user.id, type: 'settle' } })).toBe(5);
  });

  it('releases technical and policy failures and keeps an ambiguous hold', async () => {
    const admin = await loginAdmin();
    const user = await register('Failure');
    await credit(admin, user.id, 6);
    const technical = await http()
      .post('/v1/generations')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ generationConfigurationId: IMAGE, input: { prompt: '[fail] cup', aspectRatio: '1:1' } });
    expect(technical.status).toBe(202);
    await finish(technical.body.data.id as string);
    const technicalView = await http()
      .get(`/v1/generations/${technical.body.data.id}`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(technicalView.body.data.status).toBe('failed');
    expect(JSON.stringify(technicalView.body).toLowerCase()).not.toMatch(/higgsfield|kling|soul/);
    expect(await walletOf(user.token)).toEqual({ balanceCredits: 6, heldCredits: 0 });

    const policy = await http()
      .post('/v1/generations')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ generationConfigurationId: IMAGE, input: { prompt: '[policy] cup', aspectRatio: '1:1' } });
    await finish(policy.body.data.id as string);
    expect(await walletOf(user.token)).toEqual({ balanceCredits: 6, heldCredits: 0 });

    const ambiguous = await http()
      .post('/v1/generations')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ generationConfigurationId: IMAGE, input: { prompt: '[ambiguous] cup', aspectRatio: '1:1' } });
    await finish(ambiguous.body.data.id as string);
    const view = await http()
      .get(`/v1/generations/${ambiguous.body.data.id}`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(view.body.data.status).toBe('processing');
    expect(await walletOf(user.token)).toEqual({ balanceCredits: 6, heldCredits: 2 });
    const stored = await prisma.generation.findUniqueOrThrow({ where: { id: ambiguous.body.data.id } });
    expect(stored.status).toBe('needs_reconciliation');
  });

  it('keeps the snapshotted price after the configuration changes', async () => {
    const admin = await loginAdmin();
    const user = await register('Price');
    await credit(admin, user.id, 4);
    const created = await http()
      .post('/v1/generations')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ generationConfigurationId: IMAGE, input: { prompt: 'priced cup', aspectRatio: '1:1' } });
    expect(created.body.data.costCredits).toBe(2);
    await prisma.generationConfiguration.update({ where: { id: IMAGE }, data: { costCredits: 9 } });
    try {
      const stored = await prisma.generation.findUniqueOrThrow({ where: { id: created.body.data.id } });
      expect(stored.costCredits).toBe(2);
    } finally {
      await prisma.generationConfiguration.update({ where: { id: IMAGE }, data: { costCredits: 2 } });
    }
  });

  it('hides other users resources and publishes only a finished creation', async () => {
    const admin = await loginAdmin();
    const owner = await register('Owner');
    const other = await register('Other');
    await credit(admin, owner.id, 20);
    const upload = await http()
      .post('/v1/uploads')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', PNG, { filename: 'dot.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    const spoofed = await http()
      .post('/v1/uploads')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('not an image'), { filename: 'note.png', contentType: 'image/png' });
    expect(spoofed.status).toBe(422);
    expect(spoofed.body.error.code).toBe('UPLOAD_INVALID');
    const created = await http()
      .post('/v1/generations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        generationConfigurationId: IMAGE_TO_VIDEO,
        sourceUploadId: upload.body.data.id,
        input: { prompt: 'slow push' },
      });
    expect(created.status).toBe(202);
    const hidden = await http()
      .get(`/v1/generations/${created.body.data.id}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(hidden.status).toBe(404);
    const tooSoon = await http()
      .post(`/v1/generations/${created.body.data.id}/publish`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(tooSoon.status).toBe(422);
    await finish(created.body.data.id as string);
    const view = await http()
      .get(`/v1/generations/${created.body.data.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(view.body.data.status).toBe('completed');
    const assetId = view.body.data.outputAsset.id as string;
    const stolen = await http().get(`/v1/assets/${assetId}/download`).set('Authorization', `Bearer ${other.token}`);
    expect(stolen.status).toBe(404);
    const privateExplore = await http().get(`/v1/explore/${created.body.data.id}`);
    expect(privateExplore.status).toBe(404);
    const published = await http()
      .post(`/v1/generations/${created.body.data.id}/publish`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(published.status).toBe(200);
    const explore = await http().get(`/v1/explore/${created.body.data.id}`);
    expect(explore.status).toBe(200);
    expect(explore.body.data.toolType).toBe('image_to_video');
    expect(explore.body.data.prompt).toBeUndefined();
    const ownerStill = await http()
      .get(`/v1/generations/${created.body.data.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerStill.status).toBe(200);
    await http().post(`/v1/generations/${created.body.data.id}/unpublish`).set('Authorization', `Bearer ${owner.token}`);
    expect((await http().get(`/v1/explore/${created.body.data.id}`)).status).toBe(404);
    expect(
      (await http().get(`/v1/explore/${created.body.data.id}`).set('Authorization', `Bearer ${other.token}`)).status,
    ).toBe(404);
  });

  it('credits a signed webhook once and ignores a bad signature or a failed payment', async () => {
    const user = await register('Pay');
    const first = await http()
      .post('/v1/payments/topups')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ creditPackageId: PACKAGE, mobileMoneyDetails: { phoneNumber: '0712345678' } });
    expect(first.status).toBe(202);
    expect(await walletOf(user.token)).toEqual({ balanceCredits: 0, heldCredits: 0 });
    const secret = process.env.SNIPPE_WEBHOOK_SECRET ?? '';
    const send = async (paymentId: string, reference: string, event: string, amount: number, signature?: string) => {
      // Send the signed UTF-8 string. Superagent JSON.stringifies a Buffer when
      // Content-Type is application/json, which would not match the HMAC.
      const raw = JSON.stringify({
        event,
        data: { reference, status: event.replace('payment.', ''), amount, metadata: { payment_id: paymentId } },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      return http()
        .post('/v1/webhooks/snippe')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Timestamp', timestamp)
        .set('X-Webhook-Signature', signature ?? signSnippeWebhook(Buffer.from(raw), timestamp, secret))
        .set('X-Webhook-Event', event)
        .send(raw);
    };
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: first.body.data.id } });
    const ok = await send(payment.id, payment.snippeTransactionId ?? '', 'payment.completed', payment.amountTzs);
    expect(ok.status).toBe(200);
    expect(await walletOf(user.token)).toEqual({ balanceCredits: 20, heldCredits: 0 });
    const again = await send(payment.id, payment.snippeTransactionId ?? '', 'payment.completed', payment.amountTzs);
    expect(again.status).toBe(200);
    expect(await walletOf(user.token)).toEqual({ balanceCredits: 20, heldCredits: 0 });

    const second = await http()
      .post('/v1/payments/topups')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ creditPackageId: PACKAGE, mobileMoneyDetails: { phoneNumber: '0712345678' } });
    const pending = await prisma.payment.findUniqueOrThrow({ where: { id: second.body.data.id } });
    const forged = await send(pending.id, pending.snippeTransactionId ?? '', 'payment.completed', pending.amountTzs, 'deadbeef');
    expect(forged.status).toBe(401);
    expect(await walletOf(user.token)).toEqual({ balanceCredits: 20, heldCredits: 0 });
    const failed = await send(pending.id, pending.snippeTransactionId ?? '', 'payment.failed', pending.amountTzs);
    expect(failed.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('failed');
    expect(await walletOf(user.token)).toEqual({ balanceCredits: 20, heldCredits: 0 });
  });

  it('blocks non-admins and records an admin mutation with a reason', async () => {
    const user = await register('Member');
    const forbidden = await http().get('/v1/admin/users').set('Authorization', `Bearer ${user.token}`);
    expect(forbidden.status).toBe(403);
    const admin = await loginAdmin();
    const me = await http().get('/v1/auth/me').set('Authorization', `Bearer ${admin}`);
    const empty = await http()
      .post(`/v1/admin/users/${user.id}/credit-adjustments`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ amountCredits: 5, reason: '   ' });
    expect(empty.status).toBe(400);
    const large = await http()
      .post(`/v1/admin/users/${user.id}/credit-adjustments`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ amountCredits: 1000, reason: 'Large test grant' });
    expect(large.status).toBe(400);
    expect(large.body.error.code).toBe('CONFIRMATION_REQUIRED');
    await credit(admin, user.id, 5);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: user.id, actionType: 'credit_adjustment' },
    });
    expect(audit?.reason).toBe('Test balance');
    const self = await http()
      .post(`/v1/admin/users/${me.body.data.id}/suspend`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'Should not lock myself out' });
    expect(self.status).toBe(400);
  });
});

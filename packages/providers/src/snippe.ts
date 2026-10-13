import { createHmac, timingSafeEqual } from 'node:crypto';

export function snippeIdempotencyKey(paymentId: string): string {
  return paymentId.replaceAll('-', '').slice(0, 30);
}

export function signSnippeWebhook(rawBody: Buffer, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
}

export function verifySnippeWebhook(
  rawBody: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!timestamp || !signature || !secret) return false;
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return false;
  const timestampMs = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  if (Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) return false;
  const expected = signSnippeWebhook(rawBody, timestamp, secret);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type ProviderPaymentStatus = 'pending' | 'completed' | 'failed';

export type PaymentInitiation = {
  paymentId: string;
  idempotencyKey: string;
  amountTzs: number;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  webhookUrl: string;
};

export interface PaymentGateway {
  readonly name: 'fake' | 'snippe';
  initiate(input: PaymentInitiation): Promise<{ reference: string }>;
  getStatus(reference: string): Promise<{ status: ProviderPaymentStatus }>;
}

export class FakePaymentGateway implements PaymentGateway {
  readonly name = 'fake' as const;

  async initiate(input: PaymentInitiation): Promise<{ reference: string }> {
    return { reference: `fake_${input.paymentId.replaceAll('-', '').slice(0, 24)}` };
  }

  async getStatus(): Promise<{ status: ProviderPaymentStatus }> {
    return { status: 'pending' };
  }
}

type SnippeEnv = {
  SNIPPE_API_KEY?: string;
  SNIPPE_API_BASE_URL?: string;
};

export class SnippePaymentGateway implements PaymentGateway {
  readonly name = 'snippe' as const;
  private readonly env: SnippeEnv;

  constructor(env: SnippeEnv) {
    this.env = env;
  }

  async initiate(input: PaymentInitiation): Promise<{ reference: string }> {
    const base = (this.env.SNIPPE_API_BASE_URL || 'https://api.snippe.sh').replace(/\/$/, '');
    const response = await fetch(`${base}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.SNIPPE_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        payment_type: 'mobile',
        details: {
          amount: input.amountTzs,
          currency: 'TZS',
          phone_number: input.phoneNumber,
        },
        customer: {
          firstname: input.firstName,
          lastname: input.lastName,
          email: input.email,
        },
        webhook_url: input.webhookUrl,
        metadata: { payment_id: input.paymentId },
      }),
    });
    if (!response.ok) {
      throw new Error(`Snippe initiation failed with status ${response.status}`);
    }
    const body = (await response.json()) as { data?: { reference?: string }; reference?: string };
    const reference = body.data?.reference ?? body.reference;
    if (!reference) throw new Error('Snippe initiation did not return a reference.');
    return { reference: String(reference) };
  }

  async getStatus(reference: string): Promise<{ status: ProviderPaymentStatus }> {
    const base = (this.env.SNIPPE_API_BASE_URL || 'https://api.snippe.sh').replace(/\/$/, '');
    const response = await fetch(`${base}/v1/payments/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${this.env.SNIPPE_API_KEY ?? ''}` },
    });
    if (!response.ok) return { status: 'pending' };
    const body = (await response.json()) as { data?: { status?: string }; status?: string };
    return { status: mapSnippeStatus(body.data?.status ?? body.status) };
  }
}

export function mapSnippeStatus(status: string | undefined): ProviderPaymentStatus {
  const normalized = (status ?? '').toLowerCase();
  if (normalized === 'completed' || normalized === 'success' || normalized === 'successful') return 'completed';
  if (normalized === 'failed' || normalized === 'expired' || normalized === 'voided' || normalized === 'cancelled') {
    return 'failed';
  }
  return 'pending';
}

export function createPaymentGateway(env: SnippeEnv & { NODE_ENV?: string; PAYMENT_PROVIDER?: string }): PaymentGateway {
  const mode = env.PAYMENT_PROVIDER ?? (env.NODE_ENV === 'production' ? 'snippe' : 'fake');
  if (mode === 'fake') {
    if (env.NODE_ENV === 'production') {
      throw new Error('PAYMENT_PROVIDER=fake is not allowed in production.');
    }
    return new FakePaymentGateway();
  }
  if (!env.SNIPPE_API_KEY && env.NODE_ENV === 'production') {
    throw new Error('SNIPPE_API_KEY is required in production.');
  }
  if (!env.SNIPPE_API_KEY) return new FakePaymentGateway();
  return new SnippePaymentGateway(env);
}

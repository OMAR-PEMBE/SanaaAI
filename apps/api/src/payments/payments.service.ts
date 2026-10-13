import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { confirmCompletedPayment } from '@sanaaai/db';
import {
  createPaymentGateway,
  mapSnippeStatus,
  sanitizeProviderPayload,
  signSnippeWebhook,
  snippeIdempotencyKey,
  toSnippePhone,
  verifySnippeWebhook,
  type PaymentGateway,
} from '@sanaaai/providers';
import { ApiError, headerValue, securityLog } from '../common/http.js';
import { PrismaService } from '../core/prisma.service.js';

type WebhookHeaders = Record<string, string | string[] | undefined>;

@Injectable()
export class PaymentsService {
  private readonly gateway: PaymentGateway;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.gateway = createPaymentGateway(process.env);
  }

  async createTopup(input: {
    userId: string;
    email: string;
    fullName: string;
    creditPackageId: string;
    phoneNumber: string;
    idempotencyKey?: string;
  }) {
    const key = input.idempotencyKey?.trim();
    if (key) {
      const existing = await this.prisma.payment.findFirst({
        where: { userId: input.userId, clientIdempotencyKey: key },
      });
      if (existing) return this.present(existing);
    }
    const creditPackage = await this.prisma.creditPackage.findFirst({
      where: { id: input.creditPackageId, isActive: true },
    });
    if (!creditPackage) throw new ApiError(404, 'NOT_FOUND', 'That package is not available.');
    if (creditPackage.amountTzs < 500) {
      throw new ApiError(422, 'UNSUPPORTED_CONFIGURATION', 'That package is below the minimum payment.');
    }
    const phoneNumber = toSnippePhone(input.phoneNumber);
    if (!phoneNumber) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Enter a Tanzania mobile number.', {
        fields: { phoneNumber: 'Use a number starting with 255 or 0.' },
      });
    }
    const payment = await this.prisma.payment.create({
      data: {
        userId: input.userId,
        creditPackageId: creditPackage.id,
        amountTzs: creditPackage.amountTzs,
        creditsGranted: creditPackage.creditsGranted,
        clientIdempotencyKey: key || null,
      },
    });
    const parts = input.fullName.trim().split(/\s+/);
    try {
      const initiated = await this.gateway.initiate({
        paymentId: payment.id,
        idempotencyKey: snippeIdempotencyKey(payment.id),
        amountTzs: payment.amountTzs,
        phoneNumber,
        firstName: parts[0] ?? 'Customer',
        lastName: parts.slice(1).join(' ') || parts[0] || 'Customer',
        email: input.email,
        webhookUrl: `${this.config.get<string>('API_BASE_URL') ?? 'http://localhost:4000'}/v1/webhooks/snippe`,
      });
      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { snippeTransactionId: initiated.reference },
      });
      return this.present(updated);
    } catch (error) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
      securityLog('payment_initiation_failed', {
        paymentId: payment.id,
        message: error instanceof Error ? error.message : 'error',
      });
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'The payment could not be started. Try again.');
    }
  }

  present(payment: {
    id: string;
    status: string;
    amountTzs: number;
    creditsGranted: number;
    confirmedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      paymentId: payment.id,
      id: payment.id,
      status: payment.status,
      amountTzs: payment.amountTzs,
      creditsGranted: payment.creditsGranted,
      confirmedAt: payment.confirmedAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
      devSimulation: process.env.NODE_ENV === 'development' && this.gateway.name === 'fake',
    };
  }

  async getOwn(userId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id, userId } });
    if (!payment) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    return payment;
  }

  async devConfirm(userId: string, paymentId: string): Promise<void> {
    if (process.env.NODE_ENV !== 'development' || this.gateway.name !== 'fake') {
      throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    }
    const payment = await this.getOwn(userId, paymentId);
    const secret = this.config.get<string>('SNIPPE_WEBHOOK_SECRET') ?? '';
    const body = Buffer.from(
      JSON.stringify({
        event: 'payment.completed',
        data: {
          reference: payment.snippeTransactionId,
          status: 'completed',
          amount: payment.amountTzs,
          metadata: { payment_id: payment.id },
        },
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    await this.handleWebhook(body, {
      'x-webhook-timestamp': timestamp,
      'x-webhook-signature': signSnippeWebhook(body, timestamp, secret),
      'x-webhook-event': 'payment.completed',
    });
  }

  async handleWebhook(rawBody: Buffer, headers: WebhookHeaders): Promise<void> {
    const secret = this.config.get<string>('SNIPPE_WEBHOOK_SECRET') ?? '';
    const timestamp = headerValue(headers['x-webhook-timestamp']);
    const signature = headerValue(headers['x-webhook-signature']);
    const verified = verifySnippeWebhook(rawBody, timestamp, signature, secret);
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawBody.toString('utf8')) as unknown;
      if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const data = payload.data && typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : {};
    const metadata =
      data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {};
    const reference = stringValue(data.reference) ?? stringValue(payload.reference);
    const paymentId = stringValue(metadata.payment_id) ?? stringValue(metadata.paymentId);
    const payment = await this.findPayment(reference, paymentId);
    if (!verified) {
      securityLog('webhook_signature_invalid', { paymentId: payment?.id ?? null });
      if (payment) {
        await this.prisma.paymentEvent.create({
          data: {
            paymentId: payment.id,
            eventType: headerValue(headers['x-webhook-event']) ?? 'invalid',
            rawPayload: sanitizeProviderPayload(payload) as object,
            signatureVerified: false,
            processed: false,
          },
        });
      }
      throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
    }
    if (!payment) {
      securityLog('webhook_payment_unknown', { reference: reference ?? null });
      return;
    }
    const eventType = headerValue(headers['x-webhook-event']) ?? stringValue(payload.event) ?? 'unknown';
    const event = await this.prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventType,
        rawPayload: sanitizeProviderPayload(payload) as object,
        signatureVerified: true,
        processed: false,
      },
    });
    const status = mapSnippeStatus(stringValue(data.status) ?? eventType.replace('payment.', ''));
    const amount = data.amount ?? payload.amount;
    if (amount !== undefined && Number(amount) !== payment.amountTzs) {
      securityLog('payment_amount_mismatch', { paymentId: payment.id });
      return;
    }
    if (status === 'completed') {
      const result = await confirmCompletedPayment(this.prisma, {
        paymentId: payment.id,
        snippeReference: reference ?? payment.snippeTransactionId ?? payment.id,
      });
      if (result === 'confirmed') {
        await this.prisma.paymentEvent.update({ where: { id: event.id }, data: { processed: true } });
      }
      return;
    }
    if (status === 'failed') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'failed' },
      });
      await this.prisma.paymentEvent.update({ where: { id: event.id }, data: { processed: true } });
    }
  }

  private async findPayment(reference: string | null, paymentId: string | null) {
    if (reference) {
      const byReference = await this.prisma.payment.findUnique({ where: { snippeTransactionId: reference } });
      if (byReference) return byReference;
    }
    if (paymentId) return this.prisma.payment.findUnique({ where: { id: paymentId } });
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

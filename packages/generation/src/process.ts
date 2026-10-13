import type { PrismaClient } from '@sanaaai/db';
import { releaseGeneration, settleGeneration, withTransaction } from '@sanaaai/db';
import type { AiGenerationProvider, ObjectStorage, PaymentGateway } from '@sanaaai/providers';

const TERMINAL = new Set(['completed', 'failed']);

function publicSourceUrl(storageKey: string | null | undefined): string | null {
  const cdn = process.env.STORAGE_PUBLIC_CDN_URL?.replace(/\/$/, '');
  if (!storageKey || !cdn?.startsWith('https://')) return null;
  return `${cdn}/${storageKey.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function knownDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : 'technical';
  if (
    message === 'missing_credentials' ||
    message === 'endpoint_not_configured' ||
    message === 'source_not_public' ||
    message === 'policy' ||
    message === 'technical'
  ) {
    return message;
  }
  return message.slice(0, 500);
}

export async function processGenerationJob(
  generationId: string,
  deps: { prisma: PrismaClient; provider: AiGenerationProvider; storage: ObjectStorage },
): Promise<void> {
  const generation = await deps.prisma.generation.findUnique({
    where: { id: generationId },
    include: { configuration: true, sourceUpload: true },
  });
  if (!generation || TERMINAL.has(generation.status)) return;

  const input = generation.input as { prompt?: string; aspectRatio?: string };
  const request = {
    generationId: generation.id,
    toolType: generation.toolType,
    prompt: input.prompt ?? null,
    aspectRatio: input.aspectRatio ?? null,
    durationSeconds: generation.configuration.durationSeconds,
    // A public CDN is required for a real image-to-video source. Local disk is not reachable by the provider.
    // Saving the provider request id below happens before polling. A lost HTTP response before that save can submit twice; the wallet still settles once.
    sourceImageUrl: publicSourceUrl(generation.sourceUpload?.storageKey),
    modelUsed: generation.modelUsed,
  };

  let submission = {
    providerRequestId: generation.providerRequestId ?? '',
    providerStatusUrl: generation.providerStatusUrl,
  };

  try {
    if (!submission.providerRequestId) {
      submission = await deps.provider.submit(request);
      await deps.prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: 'submitted',
          providerRequestId: submission.providerRequestId,
          providerStatusUrl: submission.providerStatusUrl,
        },
      });
    } else if (generation.status === 'pending') {
      await deps.prisma.generation.update({ where: { id: generation.id }, data: { status: 'submitted' } });
    }

    await deps.prisma.generation.update({ where: { id: generation.id }, data: { status: 'processing' } });
    const result = await deps.provider.resolve(request, submission);

    if (result.outcome === 'ambiguous') {
      await deps.prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: 'needs_reconciliation',
          providerRequestId: result.providerRequestId,
          providerStatusUrl: result.providerStatusUrl,
          failureReason: result.detail,
        },
      });
      return;
    }

    if (result.outcome === 'failed') {
      const detail = result.kind === 'policy' ? 'policy' : result.detail;
      await withTransaction(deps.prisma, async (tx) => {
        const released = await releaseGeneration(tx, generation.id);
        if (released === 'already_terminal') return;
        await tx.generation.update({
          where: { id: generation.id },
          data: {
            status: 'failed',
            failureReason: detail,
            completedAt: new Date(),
            providerRequestId: result.providerRequestId,
            providerStatusUrl: result.providerStatusUrl,
          },
        });
      });
      return;
    }

    const storageKey = `assets/${generation.userId}/${generation.id}`;
    await deps.storage.put(storageKey, result.bytes, result.mimeType);
    await withTransaction(deps.prisma, async (tx) => {
      const settled = await settleGeneration(tx, generation.id);
      if (settled === 'already_terminal') return;
      const asset = await tx.asset.create({
        data: {
          generationId: generation.id,
          userId: generation.userId,
          storageKey,
          mimeType: result.mimeType,
          fileSizeBytes: BigInt(result.bytes.length),
        },
      });
      await tx.generation.update({
        where: { id: generation.id },
        data: {
          status: 'completed',
          outputAssetId: asset.id,
          completedAt: new Date(),
          providerRequestId: result.providerRequestId,
          providerStatusUrl: result.providerStatusUrl,
          providerCostAmount: result.providerCostAmount,
          providerCostCurrency: result.providerCostCurrency,
          failureReason: null,
        },
      });
    });
  } catch (error) {
    const detail = knownDetail(error);
    if (detail === 'missing_credentials' || detail === 'endpoint_not_configured' || detail === 'source_not_public') {
      await withTransaction(deps.prisma, async (tx) => {
        const released = await releaseGeneration(tx, generation.id);
        if (released === 'already_terminal') return;
        await tx.generation.update({
          where: { id: generation.id },
          data: { status: 'failed', failureReason: detail, completedAt: new Date() },
        });
      });
      return;
    }
    throw error;
  }
}

export async function failOpenGeneration(
  prisma: PrismaClient,
  generationId: string,
  detail: string,
): Promise<void> {
  const generation = await prisma.generation.findUnique({ where: { id: generationId } });
  if (!generation || TERMINAL.has(generation.status) || generation.status === 'needs_reconciliation') return;
  await withTransaction(prisma, async (tx) => {
    const released = await releaseGeneration(tx, generationId);
    if (released === 'already_terminal') return;
    await tx.generation.update({
      where: { id: generationId },
      data: { status: 'failed', failureReason: detail.slice(0, 500), completedAt: new Date() },
    });
  });
}

export async function reconcilePendingPayments(deps: {
  prisma: PrismaClient;
  gateway: PaymentGateway;
  confirm: (paymentId: string, reference: string) => Promise<unknown>;
  olderThanMs?: number;
}): Promise<number> {
  const cutoff = new Date(Date.now() - (deps.olderThanMs ?? 3 * 60 * 1000));
  const pending = await deps.prisma.payment.findMany({
    where: { status: 'pending', createdAt: { lt: cutoff }, snippeTransactionId: { not: null } },
    take: 50,
    orderBy: { createdAt: 'asc' },
  });
  let changed = 0;
  for (const payment of pending) {
    if (!payment.snippeTransactionId) continue;
    const remote = await deps.gateway.getStatus(payment.snippeTransactionId);
    if (remote.status === 'completed') {
      await deps.confirm(payment.id, payment.snippeTransactionId);
      changed += 1;
    } else if (remote.status === 'failed') {
      await deps.prisma.payment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'failed' },
      });
      changed += 1;
    }
  }
  return changed;
}

export async function reconcileGenerations(prisma: PrismaClient, olderThanMs = 15 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.generation.updateMany({
    where: { status: { in: ['submitted', 'processing'] }, updatedAt: { lt: cutoff } },
    data: { status: 'needs_reconciliation' },
  });
  return result.count;
}

import { confirmCompletedPayment, createPrismaClient } from '@sanaaai/db';
import {
  failOpenGeneration,
  processGenerationJob,
  reconcileGenerations,
  reconcilePendingPayments,
} from '@sanaaai/generation';
import { createGenerationProvider, createObjectStorage, createPaymentGateway } from '@sanaaai/providers';
import { Queue, Worker } from 'bullmq';

export type WorkerHandles = {
  close: () => Promise<void>;
};

export async function startWorkers(): Promise<WorkerHandles> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required.');
  const connection = { url, maxRetriesPerRequest: null as null };
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const provider = createGenerationProvider(process.env);
  const storage = createObjectStorage(process.env);
  const gateway = createPaymentGateway(process.env);

  const generations = new Worker(
    'generations',
    async (job) => {
      const generationId = String((job.data as { generationId?: string }).generationId ?? '');
      if (!generationId) return;
      await processGenerationJob(generationId, { prisma, provider, storage });
    },
    { connection, concurrency: 2 },
  );

  generations.on('failed', (job, error) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;
    const generationId = String((job.data as { generationId?: string }).generationId ?? '');
    if (!generationId) return;
    void failOpenGeneration(prisma, generationId, error.message).catch((closeError: unknown) => {
      console.log(
        JSON.stringify({
          level: 'error',
          event: 'generation_fail_open',
          message: closeError instanceof Error ? closeError.message : 'error',
        }),
      );
    });
  });

  const maintenanceQueue = new Queue('maintenance', { connection });
  const existing = await maintenanceQueue.getRepeatableJobs();
  if (!existing.some((job) => job.name === 'reconcile')) {
    await maintenanceQueue.add('reconcile', {}, { repeat: { every: 120_000 }, jobId: 'reconcile' });
  }

  const maintenance = new Worker(
    'maintenance',
    async () => {
      await reconcilePendingPayments({
        prisma,
        gateway,
        confirm: (paymentId, reference) =>
          confirmCompletedPayment(prisma, { paymentId, snippeReference: reference }),
      });
      await reconcileGenerations(prisma);
    },
    { connection },
  );

  return {
    close: async () => {
      await generations.close();
      await maintenance.close();
      await maintenanceQueue.close();
      await prisma.$disconnect();
    },
  };
}

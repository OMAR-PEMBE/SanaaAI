import { PrismaClient } from '@prisma/client';
import { ensureBootstrapAdmin } from './admin.mjs';

const prisma = new PrismaClient();

const packages = [
  ['10000000-0000-4000-8000-000000000001', 2000, 20, 1],
  ['10000000-0000-4000-8000-000000000002', 5000, 50, 2],
  ['10000000-0000-4000-8000-000000000003', 10000, 100, 3],
  ['10000000-0000-4000-8000-000000000004', 20000, 200, 4],
  ['10000000-0000-4000-8000-000000000005', 50000, 500, 5],
];

const configurations = [
  ['20000000-0000-4000-8000-000000000001', 'ai_image', null, 2, 'soul-2'],
  ['20000000-0000-4000-8000-000000000002', 'text_to_video', 5, 15, 'kling-2.5-turbo-standard'],
  ['20000000-0000-4000-8000-000000000003', 'text_to_video', 10, 30, 'kling-2.5-turbo-standard'],
  ['20000000-0000-4000-8000-000000000004', 'image_to_video', 5, 15, 'kling-2.5-turbo-standard'],
  ['20000000-0000-4000-8000-000000000005', 'image_to_video', 10, 30, 'kling-2.5-turbo-standard'],
];

const activate =
  process.env.SEED_ACTIVATE_GENERATION_CONFIGS === 'true' &&
  process.env.NODE_ENV !== 'production';

try {
  for (const [id, amountTzs, creditsGranted, sortOrder] of packages) {
    await prisma.creditPackage.upsert({
      where: { id },
      create: { id, amountTzs, creditsGranted, sortOrder, isActive: true },
      update: { amountTzs, creditsGranted, sortOrder },
    });
  }

  for (const [id, toolType, durationSeconds, costCredits, modelUsed] of configurations) {
    await prisma.generationConfiguration.upsert({
      where: { id },
      create: {
        id,
        toolType,
        durationSeconds,
        costCredits,
        modelUsed,
        isActive: activate,
      },
      update: { toolType, durationSeconds, costCredits, modelUsed },
    });
  }

  const admin = await ensureBootstrapAdmin(prisma);
  console.log(JSON.stringify({ ok: true, configsActive: activate, admin: admin.reason }));
} finally {
  await prisma.$disconnect();
}

import { createOwnerClient, ensureBootstrapAdmin } from './admin.mjs';

const prisma = createOwnerClient();
try {
  const result = await ensureBootstrapAdmin(prisma, { allowProduction: true });
  if (result.reason === 'missing_env') {
    console.error('Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD.');
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, reason: result.reason }));
} finally {
  await prisma.$disconnect();
}

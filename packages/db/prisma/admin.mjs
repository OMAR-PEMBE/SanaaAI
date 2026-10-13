import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

export async function ensureBootstrapAdmin(prisma, options = {}) {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '';
  const allowProduction = options.allowProduction === true;
  if (!email || !password) return { created: false, reason: 'missing_env' };
  if (process.env.NODE_ENV === 'production' && !allowProduction) {
    return { created: false, reason: 'production_seed_skipped' };
  }
  if (password.length < 8 || password.length > 72) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be 8 to 72 characters.');
  }
  const passwordHash = bcrypt.hashSync(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { role: 'admin', status: 'active', passwordHash },
    });
    await prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
    return { created: false, reason: 'updated', userId: user.id };
  }
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        fullName: 'Local Admin',
        passwordHash,
        role: 'admin',
      },
    });
    await tx.wallet.create({ data: { userId: created.id } });
    return created;
  });
  return { created: true, reason: 'created', userId: user.id };
}

export function createOwnerClient() {
  return new PrismaClient();
}

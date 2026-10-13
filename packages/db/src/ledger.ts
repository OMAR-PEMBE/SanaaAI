import { Prisma, type PrismaClient } from '@prisma/client';

export type LedgerTx = Prisma.TransactionClient;

export class LedgerError extends Error {
  constructor(
    readonly code: 'INSUFFICIENT_CREDITS' | 'INVALID_AMOUNT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

type WalletRow = {
  id: string;
  user_id: string;
  balance_credits: number;
  held_credits: number;
};

export function generationDescription(toolType: string, durationSeconds: number | null): string {
  if (toolType === 'ai_image') return 'AI Image';
  if (toolType === 'text_to_video') return `Text to Video, ${durationSeconds ?? ''}s`.replace(' s', 's');
  if (toolType === 'image_to_video') return `Image to Video, ${durationSeconds ?? ''}s`.replace(' s', 's');
  return 'Generation';
}

function assertPositiveInteger(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new LedgerError('INVALID_AMOUNT', 'Credit amounts must be positive integers.');
  }
}

async function lockWallet(tx: LedgerTx, userId: string): Promise<WalletRow> {
  const rows = await tx.$queryRaw<WalletRow[]>`
    SELECT id, user_id, balance_credits, held_credits
    FROM wallets
    WHERE user_id = CAST(${userId} AS uuid)
    FOR UPDATE
  `;
  const wallet = rows[0];
  if (!wallet) throw new LedgerError('NOT_FOUND', 'Wallet not found.');
  return {
    id: wallet.id,
    user_id: wallet.user_id,
    balance_credits: Number(wallet.balance_credits),
    held_credits: Number(wallet.held_credits),
  };
}

async function holdDescription(tx: LedgerTx, generationId: string): Promise<string> {
  const hold = await tx.walletTransaction.findFirst({
    where: { referenceType: 'generation', referenceId: generationId, type: 'hold' },
  });
  return hold?.description ?? 'Generation';
}

export async function placeHold(
  tx: LedgerTx,
  input: { userId: string; generationId: string; costCredits: number; description: string },
): Promise<void> {
  assertPositiveInteger(input.costCredits);
  const wallet = await lockWallet(tx, input.userId);
  if (wallet.balance_credits - wallet.held_credits < input.costCredits) {
    throw new LedgerError('INSUFFICIENT_CREDITS', 'Your credit balance is too low for this generation.');
  }
  const held = wallet.held_credits + input.costCredits;
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId: input.userId,
      type: 'hold',
      amountCredits: -input.costCredits,
      balanceAfter: wallet.balance_credits,
      referenceType: 'generation',
      referenceId: input.generationId,
      description: input.description,
      actorType: 'user',
      actorId: input.userId,
    },
  });
  await tx.wallet.update({
    where: { id: wallet.id },
    data: { heldCredits: held },
  });
}

export async function settleGeneration(
  tx: LedgerTx,
  generationId: string,
): Promise<'settled' | 'already_terminal'> {
  const generation = await tx.generation.findUnique({ where: { id: generationId } });
  if (!generation) throw new LedgerError('NOT_FOUND', 'Generation not found.');
  const terminal = await tx.walletTransaction.findFirst({
    where: {
      referenceType: 'generation',
      referenceId: generationId,
      type: { in: ['settle', 'release'] },
    },
  });
  if (terminal) return 'already_terminal';
  const wallet = await lockWallet(tx, generation.userId);
  const cost = generation.costCredits;
  if (wallet.held_credits < cost || wallet.balance_credits < cost) {
    throw new LedgerError('INVALID_AMOUNT', 'The wallet cannot settle this hold.');
  }
  const balance = wallet.balance_credits - cost;
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId: generation.userId,
      type: 'settle',
      amountCredits: -cost,
      balanceAfter: balance,
      referenceType: 'generation',
      referenceId: generationId,
      description: await holdDescription(tx, generationId),
      actorType: 'system',
    },
  });
  await tx.wallet.update({
    where: { id: wallet.id },
    data: { balanceCredits: balance, heldCredits: wallet.held_credits - cost },
  });
  return 'settled';
}

export async function releaseGeneration(
  tx: LedgerTx,
  generationId: string,
): Promise<'released' | 'already_terminal'> {
  const generation = await tx.generation.findUnique({ where: { id: generationId } });
  if (!generation) throw new LedgerError('NOT_FOUND', 'Generation not found.');
  const terminal = await tx.walletTransaction.findFirst({
    where: {
      referenceType: 'generation',
      referenceId: generationId,
      type: { in: ['settle', 'release'] },
    },
  });
  if (terminal) return 'already_terminal';
  const wallet = await lockWallet(tx, generation.userId);
  const cost = generation.costCredits;
  if (wallet.held_credits < cost) {
    throw new LedgerError('INVALID_AMOUNT', 'The wallet has no matching hold to release.');
  }
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId: generation.userId,
      type: 'release',
      amountCredits: cost,
      balanceAfter: wallet.balance_credits,
      referenceType: 'generation',
      referenceId: generationId,
      description: await holdDescription(tx, generationId),
      actorType: 'system',
    },
  });
  await tx.wallet.update({
    where: { id: wallet.id },
    data: { heldCredits: wallet.held_credits - cost },
  });
  return 'released';
}

export async function creditTopup(
  tx: LedgerTx,
  input: { paymentId: string; userId: string; credits: number; description: string },
): Promise<'credited' | 'already'> {
  assertPositiveInteger(input.credits);
  const existing = await tx.walletTransaction.findFirst({
    where: { referenceType: 'payment', referenceId: input.paymentId, type: 'topup' },
  });
  if (existing) return 'already';
  const wallet = await lockWallet(tx, input.userId);
  const balance = wallet.balance_credits + input.credits;
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId: input.userId,
      type: 'topup',
      amountCredits: input.credits,
      balanceAfter: balance,
      referenceType: 'payment',
      referenceId: input.paymentId,
      description: input.description,
      actorType: 'system',
    },
  });
  await tx.wallet.update({
    where: { id: wallet.id },
    data: { balanceCredits: balance },
  });
  return 'credited';
}

export async function adminAdjust(
  tx: LedgerTx,
  input: {
    userId: string;
    amountCredits: number;
    auditId: string;
    description: string;
    adminUserId: string;
  },
): Promise<{ balanceCredits: number; transactionId: string }> {
  if (!Number.isInteger(input.amountCredits) || input.amountCredits === 0) {
    throw new LedgerError('INVALID_AMOUNT', 'Adjustment amount must be a non-zero integer.');
  }
  const description = input.description.trim();
  if (description.length === 0) {
    throw new LedgerError('INVALID_AMOUNT', 'A reason is required.');
  }
  const wallet = await lockWallet(tx, input.userId);
  const balance = wallet.balance_credits + input.amountCredits;
  if (balance < 0 || balance < wallet.held_credits) {
    throw new LedgerError('INVALID_AMOUNT', 'This adjustment would break the wallet.');
  }
  const row = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId: input.userId,
      type: 'admin_adjustment',
      amountCredits: input.amountCredits,
      balanceAfter: balance,
      referenceType: 'admin_adjustment',
      referenceId: input.auditId,
      description,
      actorType: 'admin',
      actorId: input.adminUserId,
    },
  });
  await tx.wallet.update({
    where: { id: wallet.id },
    data: { balanceCredits: balance },
  });
  return { balanceCredits: balance, transactionId: row.id };
}

export function withTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: LedgerTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(fn, { timeout: 20_000 });
}

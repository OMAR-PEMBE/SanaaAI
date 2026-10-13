import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { creditTopup, withTransaction } from './ledger.js';

export type ConfirmResult = 'confirmed' | 'already' | 'missing' | 'not_pending';

type LockedPayment = {
  id: string;
  user_id: string;
  credits_granted: number;
  status: 'pending' | 'confirmed' | 'failed';
  snippe_transaction_id: string | null;
};

export async function confirmCompletedPayment(
  prisma: PrismaClient,
  input: { paymentId: string; snippeReference: string },
): Promise<ConfirmResult> {
  try {
    return await withTransaction(prisma, async (tx) => {
      const rows = await tx.$queryRaw<LockedPayment[]>`
        SELECT id, user_id, credits_granted, status, snippe_transaction_id
        FROM payments
        WHERE id = CAST(${input.paymentId} AS uuid)
        FOR UPDATE
      `;
      const payment = rows[0];
      if (!payment) return 'missing';
      if (payment.status === 'confirmed') return 'already';
      if (payment.status !== 'pending') return 'not_pending';
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'confirmed',
          confirmedAt: new Date(),
          snippeTransactionId: payment.snippe_transaction_id ?? input.snippeReference,
        },
      });
      const credit = await creditTopup(tx, {
        paymentId: payment.id,
        userId: payment.user_id,
        credits: Number(payment.credits_granted),
        description: `Top up ${Number(payment.credits_granted)} credits`,
      });
      return credit === 'already' ? 'already' : 'confirmed';
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return 'already';
    }
    throw error;
  }
}

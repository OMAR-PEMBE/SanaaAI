import { Injectable } from '@nestjs/common';
import type { GenerationStatus, ToolType } from '@sanaaai/types';
import { ApiError } from '../common/http.js';
import { cursorFilter, pageResult } from '../common/pagination.js';
import { PrismaService } from '../core/prisma.service.js';

type Cursor = { t: string; id: string } | null;

const PAYMENT_STATUSES = new Set(['pending', 'confirmed', 'failed']);
const USER_STATUSES = new Set(['active', 'suspended']);
const USER_ROLES = new Set(['user', 'admin']);
const GENERATION_STATUSES = new Set([
  'pending',
  'submitted',
  'processing',
  'completed',
  'failed',
  'needs_reconciliation',
]);
const TOOLS = new Set(['ai_image', 'text_to_video', 'image_to_video']);
const LEDGER_TYPES = new Set(['hold', 'settle', 'release', 'topup', 'refund', 'admin_adjustment']);

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async users(query: { limit: number; cursor: Cursor; q?: string; status?: string; role?: string }) {
    if (query.status && !USER_STATUSES.has(query.status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'That status filter is not available.');
    }
    if (query.role && !USER_ROLES.has(query.role)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'That role filter is not available.');
    }
    const q = query.q?.trim();
    const rows = await this.prisma.user.findMany({
      where: {
        AND: [
          query.status ? { status: query.status as 'active' } : {},
          query.role ? { role: query.role as 'user' } : {},
          q
            ? {
                OR: [
                  { email: { contains: q, mode: 'insensitive' } },
                  { fullName: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {},
          cursorFilter(query.cursor),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = pageResult(rows, query.limit, (row) => row.createdAt);
    return {
      data: page.rows.map((row) => this.userSummary(row)),
      meta: page.meta,
    };
  }

  async user(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { wallet: true, _count: { select: { generations: true, payments: true } } },
    });
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    return {
      data: {
        ...this.userSummary(user),
        status: user.status,
        wallet: user.wallet
          ? {
              balanceCredits: user.wallet.balanceCredits,
              heldCredits: user.wallet.heldCredits,
              availableCredits: user.wallet.balanceCredits - user.wallet.heldCredits,
            }
          : null,
        generationCount: user._count.generations,
        paymentCount: user._count.payments,
      },
    };
  }

  async payments(query: { limit: number; cursor: Cursor; status?: string }) {
    if (query.status && !PAYMENT_STATUSES.has(query.status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'That status filter is not available.');
    }
    const rows = await this.prisma.payment.findMany({
      where: {
        ...(query.status ? { status: query.status as 'pending' } : {}),
        ...cursorFilter(query.cursor),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = pageResult(rows, query.limit, (row) => row.createdAt);
    return {
      data: page.rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        status: row.status,
        amountTzs: row.amountTzs,
        creditsGranted: row.creditsGranted,
        snippeTransactionId: row.snippeTransactionId,
        createdAt: row.createdAt.toISOString(),
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
      })),
      meta: page.meta,
    };
  }

  async generations(query: { limit: number; cursor: Cursor; status?: string; toolType?: string }) {
    if (query.status && !GENERATION_STATUSES.has(query.status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'That status filter is not available.');
    }
    if (query.toolType && !TOOLS.has(query.toolType)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'That tool filter is not available.');
    }
    const rows = await this.prisma.generation.findMany({
      where: {
        ...(query.status ? { status: query.status as GenerationStatus } : {}),
        ...(query.toolType ? { toolType: query.toolType as ToolType } : {}),
        ...cursorFilter(query.cursor),
      },
      include: { producedAsset: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = pageResult(rows, query.limit, (row) => row.createdAt);
    return {
      data: page.rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        status: row.status,
        toolType: row.toolType,
        modelUsed: row.modelUsed,
        costCredits: row.costCredits,
        failureReason: row.failureReason,
        providerRequestId: row.providerRequestId,
        assetId: row.producedAsset?.id ?? null,
        moderationStatus: row.producedAsset?.moderationStatus ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: page.meta,
    };
  }

  async ledger(query: { limit: number; cursor: Cursor; userId?: string; type?: string }) {
    if (query.type && !LEDGER_TYPES.has(query.type)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'That transaction type is not available.');
    }
    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.type ? { type: query.type as 'hold' } : {}),
        ...cursorFilter(query.cursor),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = pageResult(rows, query.limit, (row) => row.createdAt);
    return {
      data: page.rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        type: row.type,
        amountCredits: row.amountCredits,
        balanceAfter: row.balanceAfter,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        description: row.description,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: page.meta,
    };
  }

  async setStatus(adminId: string, userId: string, status: 'suspended' | 'active', reason: string) {
    const clean = this.reason(reason);
    if (status === 'suspended' && adminId === userId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'You cannot suspend your own account.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status,
          ...(status === 'suspended' ? { sessionVersion: { increment: 1 } } : {}),
        },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          adminUserId: adminId,
          actionType: status === 'suspended' ? 'user_suspend' : 'user_reactivate',
          targetType: 'user',
          targetId: userId,
          reason: clean,
        },
      }),
    ]);
    return { data: { id: userId, status } };
  }

  async hide(adminId: string, assetId: string, reason: string) {
    const clean = this.reason(reason);
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    await this.prisma.$transaction([
      this.prisma.asset.update({
        where: { id: assetId },
        data: { moderationStatus: 'rejected' },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          adminUserId: adminId,
          actionType: 'content_hide',
          targetType: 'asset',
          targetId: assetId,
          reason: clean,
        },
      }),
    ]);
    return { data: { assetId, moderationStatus: 'rejected' } };
  }

  private userSummary(user: { id: string; fullName: string; email: string; role: string; status: string; createdAt: Date }) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private reason(reason: string): string {
    const clean = reason?.trim() ?? '';
    if (!clean) throw new ApiError(400, 'VALIDATION_ERROR', 'A reason is required.');
    return clean;
  }
}

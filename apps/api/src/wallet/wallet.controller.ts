import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.service.js';
import { Public } from '../common/auth.guard.js';
import { ApiError } from '../common/http.js';
import { cursorFilter, decodeCursor, pageResult, parseLimit } from '../common/pagination.js';
import { PrismaService } from '../core/prisma.service.js';

const TRANSACTION_TYPES = new Set(['hold', 'settle', 'release', 'topup', 'refund', 'admin_adjustment']);

@Controller()
export class WalletController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('wallet')
  async wallet(@Req() req: Request & { user: AuthUser }) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: req.user.id } });
    if (!wallet) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    return {
      data: {
        balanceCredits: wallet.balanceCredits,
        heldCredits: wallet.heldCredits,
      },
    };
  }

  @Get('wallet/transactions')
  async transactions(
    @Req() req: Request & { user: AuthUser },
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursorRaw?: string,
    @Query('type') type?: string,
  ) {
    if (type && !TRANSACTION_TYPES.has(type)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'That transaction type is not available.');
    }
    const limit = parseLimit(limitRaw);
    const cursor = decodeCursor(cursorRaw);
    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        userId: req.user.id,
        ...(type ? { type: type as 'hold' } : {}),
        ...cursorFilter(cursor),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = pageResult(rows, limit, (row) => row.createdAt);
    return {
      data: page.rows.map((row) => ({
        id: row.id,
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

  @Public()
  @Get('wallet/packages')
  async packages() {
    const rows = await this.prisma.creditPackage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      data: rows.map((row) => ({
        id: row.id,
        amountTzs: row.amountTzs,
        creditsGranted: row.creditsGranted,
        sortOrder: row.sortOrder,
      })),
    };
  }
}

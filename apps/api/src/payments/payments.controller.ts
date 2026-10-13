import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../common/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { parseBody } from '../common/http.js';
import { cursorFilter, decodeCursor, pageResult, parseLimit } from '../common/pagination.js';
import { PrismaService } from '../core/prisma.service.js';
import { RedisService } from '../core/redis.service.js';
import { PaymentsService } from './payments.service.js';

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Post('payments/topups')
  @HttpCode(202)
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request & { user: AuthUser },
  ) {
    const input = parseBody(
      z.object({
        creditPackageId: z.string().uuid(),
        mobileMoneyDetails: z.object({
          phoneNumber: z.string().min(9).max(20),
          network: z.string().max(40).optional(),
        }),
      }),
      body,
    );
    const data = await this.payments.createTopup({
      userId: req.user.id,
      email: req.user.email,
      fullName: req.user.fullName,
      creditPackageId: input.creditPackageId,
      phoneNumber: input.mobileMoneyDetails.phoneNumber,
      idempotencyKey,
    });
    return { data };
  }

  @Get('payments')
  async list(
    @Req() req: Request & { user: AuthUser },
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursorRaw?: string,
  ) {
    const limit = parseLimit(limitRaw);
    const cursor = decodeCursor(cursorRaw);
    const rows = await this.prisma.payment.findMany({
      where: { userId: req.user.id, ...cursorFilter(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = pageResult(rows, limit, (row) => row.createdAt);
    return { data: page.rows.map((row) => this.payments.present(row)), meta: page.meta };
  }

  @Get('payments/:id')
  async get(@Param('id') id: string, @Req() req: Request & { user: AuthUser }) {
    return { data: this.payments.present(await this.payments.getOwn(req.user.id, id)) };
  }

  @Post('payments/:id/dev-confirm')
  @HttpCode(200)
  async devConfirm(@Param('id') id: string, @Req() req: Request & { user: AuthUser }) {
    await this.payments.devConfirm(req.user.id, id);
    return { data: this.payments.present(await this.payments.getOwn(req.user.id, id)) };
  }

  @Public()
  @Post('webhooks/snippe')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    await this.redis.consume('webhook', ip, Number(process.env.RATE_LIMIT_WEBHOOK_PER_MINUTE ?? 120), 60);
    await this.payments.handleWebhook(req.rawBody ?? Buffer.from(''), req.headers);
    return { data: { received: true } };
  }
}

import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.service.js';
import { AdminGuard } from '../common/auth.guard.js';
import { parseBody } from '../common/http.js';
import { decodeCursor, parseLimit } from '../common/pagination.js';
import { GenerationsService } from '../generations/generations.service.js';
import { AdminService } from './admin.service.js';

const reasonBody = z.object({ reason: z.string().min(1) });

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly generations: GenerationsService,
  ) {}

  @Get('users')
  users(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
  ) {
    return this.admin.users({ limit: parseLimit(limit), cursor: decodeCursor(cursor), q, status, role });
  }

  @Get('users/:id')
  user(@Param('id') id: string) {
    return this.admin.user(id);
  }

  @Get('payments')
  payments(@Query('limit') limit?: string, @Query('cursor') cursor?: string, @Query('status') status?: string) {
    return this.admin.payments({ limit: parseLimit(limit), cursor: decodeCursor(cursor), status });
  }

  @Get('generations')
  generationsList(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('status') status?: string,
    @Query('toolType') toolType?: string,
  ) {
    return this.admin.generations({ limit: parseLimit(limit), cursor: decodeCursor(cursor), status, toolType });
  }

  @Get('wallet-transactions')
  ledger(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('userId') userId?: string,
    @Query('type') type?: string,
  ) {
    return this.admin.ledger({ limit: parseLimit(limit), cursor: decodeCursor(cursor), userId, type });
  }

  @Post('users/:id/credit-adjustments')
  @HttpCode(201)
  async adjust(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const input = parseBody(
      z.object({
        amountCredits: z.number().int(),
        reason: z.string(),
        confirm: z.boolean().optional(),
      }),
      body,
    );
    const result = await this.generations.adjustCredits({
      adminId: req.user.id,
      userId: id,
      amountCredits: input.amountCredits,
      reason: input.reason,
      confirm: input.confirm ?? false,
    });
    return { data: result };
  }

  @Post('explore/:assetId/hide')
  hide(@Param('assetId') assetId: string, @Body() body: unknown, @Req() req: Request & { user: AuthUser }) {
    const input = parseBody(reasonBody, body);
    return this.admin.hide(req.user.id, assetId, input.reason);
  }

  @Post('users/:id/suspend')
  suspend(@Param('id') id: string, @Body() body: unknown, @Req() req: Request & { user: AuthUser }) {
    const input = parseBody(reasonBody, body);
    return this.admin.setStatus(req.user.id, id, 'suspended', input.reason);
  }

  @Post('users/:id/reactivate')
  reactivate(@Param('id') id: string, @Body() body: unknown, @Req() req: Request & { user: AuthUser }) {
    const input = parseBody(reasonBody, body);
    return this.admin.setStatus(req.user.id, id, 'active', input.reason);
  }
}

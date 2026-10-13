import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UPLOAD_MAX_BYTES_DEFAULT } from '@sanaaai/config';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.service.js';
import { Public } from '../common/auth.guard.js';
import { ApiError, parseBody } from '../common/http.js';
import { decodeCursor, pageResult, parseLimit } from '../common/pagination.js';
import { RedisService } from '../core/redis.service.js';
import { GenerationsService } from './generations.service.js';

@Controller()
export class GenerationsController {
  constructor(
    private readonly generations: GenerationsService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('generations/configurations')
  async configurations() {
    return { data: await this.generations.configurations() };
  }

  @Post('generations')
  @HttpCode(202)
  async create(@Body() body: unknown, @Req() req: Request & { user: AuthUser }) {
    const perHour = Number(process.env.RATE_LIMIT_GENERATION_PER_HOUR ?? 30);
    await this.redis.consume('generation', req.user.id, perHour, 60 * 60);
    const input = parseBody(
      z.object({
        generationConfigurationId: z.string().uuid(),
        sourceUploadId: z.string().uuid().nullable().optional(),
        input: z.object({
          prompt: z.string().max(2000).optional(),
          aspectRatio: z.string().max(10).optional(),
        }),
      }),
      body,
    );
    return {
      data: await this.generations.create(req.user.id, {
        generationConfigurationId: input.generationConfigurationId,
        sourceUploadId: input.sourceUploadId,
        prompt: input.input.prompt,
        aspectRatio: input.input.aspectRatio,
      }),
    };
  }

  @Get('generations')
  async list(
    @Req() req: Request & { user: AuthUser },
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursorRaw?: string,
    @Query('status') status?: string,
    @Query('toolType') toolType?: string,
  ) {
    const limit = parseLimit(limitRaw);
    const rows = await this.generations.list(req.user.id, {
      limit,
      cursor: decodeCursor(cursorRaw),
      status,
      toolType,
    });
    const page = pageResult(rows, limit, (row) => row.createdAt);
    return { data: await Promise.all(page.rows.map((row) => this.generations.present(row))), meta: page.meta };
  }

  @Get('generations/:id')
  async get(@Param('id') id: string, @Req() req: Request & { user: AuthUser }) {
    return { data: await this.generations.present(await this.generations.getOwn(req.user.id, id)) };
  }

  @Post('generations/:id/publish')
  @HttpCode(200)
  async publish(@Param('id') id: string, @Req() req: Request & { user: AuthUser }) {
    return { data: await this.generations.publish(req.user.id, id) };
  }

  @Post('generations/:id/unpublish')
  @HttpCode(200)
  async unpublish(@Param('id') id: string, @Req() req: Request & { user: AuthUser }) {
    return { data: await this.generations.unpublish(req.user.id, id) };
  }

  @Post('uploads')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES ?? UPLOAD_MAX_BYTES_DEFAULT) },
    }),
  )
  async upload(
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Req() req: Request & { user: AuthUser },
  ) {
    if (!file) {
      throw new ApiError(422, 'UPLOAD_INVALID', 'Choose a JPEG, PNG, or WebP image.');
    }
    return { data: await this.generations.saveUpload(req.user.id, file.buffer) };
  }

  @Get('assets/:id/download')
  async download(@Param('id') id: string, @Req() req: Request & { user: AuthUser }) {
    return { data: await this.generations.download(req.user.id, id) };
  }
}

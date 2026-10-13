import { Controller, Get, Param, Query } from '@nestjs/common';
import { signMediaUrl } from '@sanaaai/providers';
import { SIGNED_URL_TTL_DEFAULT_SECONDS } from '@sanaaai/config';
import { Public } from '../common/auth.guard.js';
import { ApiError } from '../common/http.js';
import { cursorFilter, decodeCursor, pageResult, parseLimit } from '../common/pagination.js';
import { PrismaService } from '../core/prisma.service.js';

@Controller()
export class ExploreController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('explore')
  async list(@Query('limit') limitRaw?: string, @Query('cursor') cursorRaw?: string) {
    const limit = parseLimit(limitRaw);
    const cursor = decodeCursor(cursorRaw);
    const rows = await this.prisma.asset.findMany({
      where: {
        moderationStatus: 'published',
        publishedAt: { not: null },
        generation: { status: 'completed' },
        ...cursorFilter(cursor, 'publishedAt'),
      },
      include: { generation: true },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = pageResult(rows, limit, (row) => row.publishedAt ?? row.createdAt);
    return {
      data: page.rows.map((row) => this.present(row)),
      meta: page.meta,
    };
  }

  @Public()
  @Get('explore/:id')
  async get(@Param('id') id: string) {
    const generation = await this.prisma.generation.findFirst({
      where: { id, status: 'completed', producedAsset: { moderationStatus: 'published' } },
      include: { producedAsset: true },
    });
    if (!generation?.producedAsset?.publishedAt) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    return {
      data: this.present({
        ...generation.producedAsset,
        generation: { id: generation.id, toolType: generation.toolType },
      }),
    };
  }

  private present(row: {
    id: string;
    mimeType: string;
    publishedAt: Date | null;
    generation: { id: string; toolType: string };
  }) {
    const ttl = Number(process.env.SIGNED_ASSET_URL_TTL_SECONDS ?? SIGNED_URL_TTL_DEFAULT_SECONDS);
    const signed = signMediaUrl({
      baseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000',
      secret: process.env.MEDIA_SIGNING_SECRET || process.env.JWT_SECRET || '',
      kind: 'asset',
      id: row.id,
      ttlSeconds: Number.isInteger(ttl) && ttl > 0 ? ttl : SIGNED_URL_TTL_DEFAULT_SECONDS,
    });
    return {
      id: row.generation.id,
      assetId: row.id,
      toolType: row.generation.toolType,
      mimeType: row.mimeType,
      url: signed.url,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    };
  }
}

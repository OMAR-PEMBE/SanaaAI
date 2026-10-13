import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ADMIN_ADJUSTMENT_CONFIRM_THRESHOLD,
  SIGNED_URL_TTL_DEFAULT_SECONDS,
  UPLOAD_MAX_BYTES_DEFAULT,
  VERIFIED_IMAGE_ASPECT_RATIOS,
} from '@sanaaai/config';
import { LedgerError, adminAdjust, generationDescription, placeHold, withTransaction } from '@sanaaai/db';
import { createObjectStorage, signMediaUrl, verifyMediaSignature, type ObjectStorage } from '@sanaaai/providers';
import { failureMessageFor, toPublicGenerationStatus, type GenerationStatus, type ToolType } from '@sanaaai/types';
import { ApiError, securityLog } from '../common/http.js';
import { PrismaService } from '../core/prisma.service.js';
import { QueueService } from '../core/queue.service.js';

const IMAGE_RATIOS = new Set<string>(VERIFIED_IMAGE_ASPECT_RATIOS);

@Injectable()
export class GenerationsService {
  private readonly storage: ObjectStorage;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly config: ConfigService,
  ) {
    this.storage = createObjectStorage(process.env);
  }

  async configurations() {
    const rows = await this.prisma.generationConfiguration.findMany({
      where: { isActive: true },
      orderBy: [{ toolType: 'asc' }, { durationSeconds: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      toolType: row.toolType,
      durationSeconds: row.durationSeconds,
      costCredits: row.costCredits,
      ...(row.toolType === 'ai_image' && row.modelUsed === 'soul-2'
        ? { aspectRatios: [...VERIFIED_IMAGE_ASPECT_RATIOS] }
        : {}),
    }));
  }

  async create(userId: string, input: { generationConfigurationId: string; sourceUploadId?: string | null; prompt?: string; aspectRatio?: string }) {
    const configuration = await this.prisma.generationConfiguration.findUnique({
      where: { id: input.generationConfigurationId },
    });
    if (!configuration?.isActive) {
      throw new ApiError(422, 'UNSUPPORTED_CONFIGURATION', 'That option is not available.');
    }
    const prompt = input.prompt?.trim() ?? '';
    if (configuration.toolType !== 'image_to_video' && prompt.length === 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Describe what you want to create.', {
        fields: { prompt: 'A prompt is required.' },
      });
    }
    if (prompt.length > 2000) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'That prompt is too long.', {
        fields: { prompt: 'Use 2000 characters or fewer.' },
      });
    }
    if (configuration.toolType === 'ai_image') {
      if (!input.aspectRatio || !IMAGE_RATIOS.has(input.aspectRatio) || configuration.modelUsed !== 'soul-2') {
        throw new ApiError(422, 'UNSUPPORTED_CONFIGURATION', 'Choose a supported aspect ratio.');
      }
    } else if (input.aspectRatio) {
      throw new ApiError(422, 'UNSUPPORTED_CONFIGURATION', 'Aspect ratio is not available for this tool.');
    }
    if (configuration.toolType === 'image_to_video') {
      if (!input.sourceUploadId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Upload an image first.', {
          fields: { sourceUploadId: 'An upload is required.' },
        });
      }
    } else if (input.sourceUploadId) {
      throw new ApiError(422, 'UNSUPPORTED_CONFIGURATION', 'This tool does not use an uploaded image.');
    }

    const storedInput = {
      ...(prompt ? { prompt } : {}),
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    };
    const description = generationDescription(configuration.toolType, configuration.durationSeconds);

    let generationId = '';
    try {
      const created = await withTransaction(this.prisma, async (tx) => {
        if (input.sourceUploadId) {
          const upload = await tx.upload.findFirst({ where: { id: input.sourceUploadId, userId } });
          if (!upload) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
        }
        const generation = await tx.generation.create({
          data: {
            userId,
            generationConfigurationId: configuration.id,
            toolType: configuration.toolType,
            modelUsed: configuration.modelUsed,
            status: 'pending',
            input: storedInput,
            sourceUploadId: input.sourceUploadId ?? null,
            costCredits: configuration.costCredits,
          },
        });
        await placeHold(tx, {
          userId,
          generationId: generation.id,
          costCredits: configuration.costCredits,
          description,
        });
        return generation;
      });
      generationId = created.id;
    } catch (error) {
      if (error instanceof LedgerError && error.code === 'INSUFFICIENT_CREDITS') {
        throw new ApiError(409, 'INSUFFICIENT_CREDITS', error.message);
      }
      throw error;
    }

    try {
      await this.queue.generations.add(
        'generate',
        { generationId },
        { jobId: generationId, attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000 },
      );
    } catch (error) {
      await withTransaction(this.prisma, async (tx) => {
        const { releaseGeneration } = await import('@sanaaai/db');
        await releaseGeneration(tx, generationId);
        await tx.generation.update({
          where: { id: generationId },
          data: { status: 'failed', failureReason: 'queue_unavailable', completedAt: new Date() },
        });
      });
      securityLog('generation_queue_failed', {
        generationId,
        message: error instanceof Error ? error.message : 'error',
      });
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'We could not start that creation. Your credits were not charged.');
    }

    await this.prisma.generation.update({ where: { id: generationId }, data: { status: 'submitted' } });
    const generation = await this.prisma.generation.findUniqueOrThrow({ where: { id: generationId } });
    return {
      id: generation.id,
      status: generation.status,
      toolType: generation.toolType,
      costCredits: generation.costCredits,
      createdAt: generation.createdAt.toISOString(),
    };
  }

  async list(userId: string, query: { limit: number; cursor: { t: string; id: string } | null; status?: string; toolType?: string }) {
    const status = this.storageStatus(query.status);
    const rows = await this.prisma.generation.findMany({
      where: {
        userId,
        ...(status ? { status: Array.isArray(status) ? { in: status } : status } : {}),
        ...(query.toolType ? { toolType: query.toolType as ToolType } : {}),
        ...(query.cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(query.cursor.t) } },
                { AND: [{ createdAt: new Date(query.cursor.t) }, { id: { lt: query.cursor.id } }] },
              ],
            }
          : {}),
      },
      include: { producedAsset: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return rows;
  }

  async getOwn(userId: string, id: string) {
    const generation = await this.prisma.generation.findFirst({
      where: { id, userId },
      include: { producedAsset: true },
    });
    if (!generation) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    return generation;
  }

  async present(
    generation: {
      id: string;
      status: GenerationStatus;
      toolType: ToolType;
      costCredits: number;
      input: unknown;
      failureReason: string | null;
      createdAt: Date;
      completedAt: Date | null;
      producedAsset: { id: string; mimeType: string; moderationStatus: string } | null;
    },
  ) {
    const status = toPublicGenerationStatus(generation.status);
    return {
      id: generation.id,
      status,
      toolType: generation.toolType,
      costCredits: generation.costCredits,
      input: generation.input,
      outputAsset: generation.producedAsset
        ? {
            id: generation.producedAsset.id,
            mimeType: generation.producedAsset.mimeType,
            url: this.sign('asset', generation.producedAsset.id).url,
          }
        : null,
      visibility: generation.producedAsset?.moderationStatus ?? 'private',
      failureMessage: generation.status === 'failed' ? failureMessageFor(generation.failureReason) : null,
      createdAt: generation.createdAt.toISOString(),
      completedAt: generation.completedAt?.toISOString() ?? null,
    };
  }

  async publish(userId: string, id: string) {
    const generation = await this.getOwn(userId, id);
    if (generation.status !== 'completed' || !generation.producedAsset) {
      throw new ApiError(422, 'GENERATION_NOT_COMPLETED', 'Only a finished creation can be shared.');
    }
    if (generation.producedAsset.moderationStatus === 'rejected') {
      throw new ApiError(422, 'CONTENT_HIDDEN', 'This creation cannot be shared.');
    }
    const asset = await this.prisma.asset.update({
      where: { id: generation.producedAsset.id },
      data: { moderationStatus: 'published', publishedAt: new Date() },
    });
    return this.visibility(asset);
  }

  async unpublish(userId: string, id: string) {
    const generation = await this.getOwn(userId, id);
    if (!generation.producedAsset) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    if (generation.producedAsset.moderationStatus === 'rejected') {
      throw new ApiError(422, 'CONTENT_HIDDEN', 'This creation cannot be shared.');
    }
    if (generation.producedAsset.moderationStatus !== 'published') {
      return this.visibility(generation.producedAsset);
    }
    const asset = await this.prisma.asset.update({
      where: { id: generation.producedAsset.id },
      data: { moderationStatus: 'private', publishedAt: null },
    });
    return this.visibility(asset);
  }

  async saveUpload(userId: string, bytes: Buffer) {
    const max = Number(process.env.UPLOAD_MAX_BYTES ?? UPLOAD_MAX_BYTES_DEFAULT);
    if (bytes.length > max) throw new ApiError(422, 'UPLOAD_TOO_LARGE', 'That file is larger than 10 MB.');
    const mimeType = detectImageMime(bytes);
    if (!mimeType) throw new ApiError(422, 'UPLOAD_INVALID', 'Use a JPEG, PNG, or WebP image.');
    const id = randomUUID();
    const storageKey = `uploads/${userId}/${id}`;
    await this.storage.put(storageKey, bytes, mimeType);
    const upload = await this.prisma.upload.create({
      data: { id, userId, storageKey, mimeType, fileSizeBytes: BigInt(bytes.length) },
    });
    return {
      id: upload.id,
      mimeType: upload.mimeType,
      url: this.sign('upload', upload.id).url,
      createdAt: upload.createdAt.toISOString(),
    };
  }

  async download(userId: string, assetId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, userId } });
    if (!asset) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    return this.sign('asset', asset.id);
  }

  async readSigned(kind: string, id: string, exp: string | undefined, sig: string | undefined): Promise<{ bytes: Buffer; mimeType: string } | null> {
    const secret = this.config.get<string>('MEDIA_SIGNING_SECRET') ?? this.config.get<string>('JWT_SECRET') ?? '';
    if (!verifyMediaSignature({ secret, kind, id, exp, sig })) return null;
    if (kind === 'asset') {
      const asset = await this.prisma.asset.findUnique({ where: { id } });
      if (!asset) return null;
      const bytes = await this.storage.get(asset.storageKey);
      if (!bytes) return null;
      return { bytes, mimeType: asset.mimeType };
    }
    if (kind === 'upload') {
      const upload = await this.prisma.upload.findUnique({ where: { id } });
      if (!upload) return null;
      const bytes = await this.storage.get(upload.storageKey);
      if (!bytes) return null;
      return { bytes, mimeType: upload.mimeType };
    }
    return null;
  }

  async adjustCredits(input: { adminId: string; userId: string; amountCredits: number; reason: string; confirm: boolean }) {
    if (Math.abs(input.amountCredits) >= ADMIN_ADJUSTMENT_CONFIRM_THRESHOLD && !input.confirm) {
      throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Confirm this large credit change.');
    }
    const reason = input.reason.trim();
    if (!reason) throw new ApiError(400, 'VALIDATION_ERROR', 'A reason is required.');
    const target = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    try {
      return await withTransaction(this.prisma, async (tx) => {
        const audit = await tx.adminAuditLog.create({
          data: {
            adminUserId: input.adminId,
            actionType: 'credit_adjustment',
            targetType: 'user',
            targetId: input.userId,
            reason,
            metadata: { amountCredits: input.amountCredits },
          },
        });
        const result = await adminAdjust(tx, {
          userId: input.userId,
          amountCredits: input.amountCredits,
          auditId: audit.id,
          description: reason,
          adminUserId: input.adminId,
        });
        return { ...result, auditId: audit.id };
      });
    } catch (error) {
      if (error instanceof LedgerError) throw new ApiError(400, 'VALIDATION_ERROR', error.message);
      throw error;
    }
  }

  private sign(kind: 'asset' | 'upload', id: string) {
    const ttl = Number(process.env.SIGNED_ASSET_URL_TTL_SECONDS ?? SIGNED_URL_TTL_DEFAULT_SECONDS);
    return signMediaUrl({
      baseUrl: this.config.get<string>('API_BASE_URL') ?? 'http://localhost:4000',
      secret: this.config.get<string>('MEDIA_SIGNING_SECRET') ?? this.config.getOrThrow<string>('JWT_SECRET'),
      kind,
      id,
      ttlSeconds: Number.isInteger(ttl) && ttl > 0 ? ttl : SIGNED_URL_TTL_DEFAULT_SECONDS,
    });
  }

  private storageStatus(status: string | undefined): GenerationStatus | GenerationStatus[] | undefined {
    if (!status) return undefined;
    if (status === 'processing') return ['processing', 'needs_reconciliation'];
    if (['pending', 'submitted', 'completed', 'failed'].includes(status)) return status as GenerationStatus;
    throw new ApiError(400, 'VALIDATION_ERROR', 'That status filter is not available.');
  }

  private visibility(asset: { id: string; moderationStatus: string; publishedAt: Date | null }) {
    return {
      assetId: asset.id,
      moderationStatus: asset.moderationStatus,
      publishedAt: asset.publishedAt?.toISOString() ?? null,
    };
  }
}

export function detectImageMime(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

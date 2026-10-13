import { fetchPublicHttps } from './ssrf.js';

export type ToolType = 'ai_image' | 'text_to_video' | 'image_to_video';

export type GenerationRequest = {
  generationId: string;
  toolType: ToolType;
  prompt: string | null;
  aspectRatio: string | null;
  durationSeconds: number | null;
  sourceImageUrl: string | null;
  modelUsed: string;
};

export type ProviderSubmission = {
  providerRequestId: string;
  providerStatusUrl: string | null;
};

export type ProviderResult =
  | {
      outcome: 'success';
      bytes: Buffer;
      mimeType: string;
      providerRequestId: string;
      providerStatusUrl: string | null;
      providerCostAmount?: string;
      providerCostCurrency?: string;
    }
  | {
      outcome: 'failed';
      kind: 'technical' | 'policy';
      detail: string;
      providerRequestId: string | null;
      providerStatusUrl: string | null;
    }
  | {
      outcome: 'ambiguous';
      detail: string;
      providerRequestId: string | null;
      providerStatusUrl: string | null;
    };

export interface AiGenerationProvider {
  readonly name: 'fake' | 'higgsfield';
  submit(request: GenerationRequest): Promise<ProviderSubmission>;
  resolve(request: GenerationRequest, submission: ProviderSubmission): Promise<ProviderResult>;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const MP4 = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAAhtZGF0',
  'base64',
);

export class FakeGenerationProvider implements AiGenerationProvider {
  readonly name = 'fake' as const;

  async submit(request: GenerationRequest): Promise<ProviderSubmission> {
    return { providerRequestId: `fake_${request.generationId}`, providerStatusUrl: null };
  }

  async resolve(request: GenerationRequest, submission: ProviderSubmission): Promise<ProviderResult> {
    const prompt = request.prompt ?? '';
    if (prompt.includes('[ambiguous]')) {
      return {
        outcome: 'ambiguous',
        detail: 'ambiguous',
        providerRequestId: submission.providerRequestId,
        providerStatusUrl: null,
      };
    }
    if (prompt.includes('[policy]')) {
      return {
        outcome: 'failed',
        kind: 'policy',
        detail: 'policy',
        providerRequestId: submission.providerRequestId,
        providerStatusUrl: null,
      };
    }
    if (prompt.includes('[fail]')) {
      return {
        outcome: 'failed',
        kind: 'technical',
        detail: 'technical',
        providerRequestId: submission.providerRequestId,
        providerStatusUrl: null,
      };
    }
    const video = request.toolType !== 'ai_image';
    return {
      outcome: 'success',
      bytes: video ? MP4 : PNG,
      mimeType: video ? 'video/mp4' : 'image/png',
      providerRequestId: submission.providerRequestId,
      providerStatusUrl: null,
    };
  }
}

export type HiggsfieldEnv = {
  NODE_ENV?: string;
  HIGGSFIELD_API_KEY_ID?: string;
  HIGGSFIELD_API_KEY_SECRET?: string;
  HIGGSFIELD_API_BASE_URL?: string;
  HIGGSFIELD_SOUL_ENDPOINT?: string;
  HIGGSFIELD_KLING_T2V_ENDPOINT?: string;
  HIGGSFIELD_KLING_I2V_ENDPOINT?: string;
};

export function buildSoulBody(request: GenerationRequest): Record<string, unknown> {
  return {
    prompt: request.prompt ?? '',
    aspect_ratio: request.aspectRatio ?? '1:1',
    batch_size: 1,
    resolution: '720p',
  };
}

function authHeader(env: HiggsfieldEnv): string | null {
  if (!env.HIGGSFIELD_API_KEY_ID || !env.HIGGSFIELD_API_KEY_SECRET) return null;
  return `Key ${env.HIGGSFIELD_API_KEY_ID}:${env.HIGGSFIELD_API_KEY_SECRET}`;
}

function endpointFor(env: HiggsfieldEnv, request: GenerationRequest): string | null {
  const base = (env.HIGGSFIELD_API_BASE_URL || 'https://api.higgsfield.ai').replace(/\/$/, '');
  if (request.toolType === 'ai_image' && request.modelUsed === 'soul-2') {
    return env.HIGGSFIELD_SOUL_ENDPOINT || `${base}/higgsfield-ai/soul/v2/standard`;
  }
  if (request.toolType === 'text_to_video') return env.HIGGSFIELD_KLING_T2V_ENDPOINT || null;
  if (request.toolType === 'image_to_video') return env.HIGGSFIELD_KLING_I2V_ENDPOINT || null;
  return null;
}

function failed(detail: string, submission?: ProviderSubmission): ProviderResult {
  return {
    outcome: 'failed',
    kind: 'technical',
    detail,
    providerRequestId: submission?.providerRequestId ?? null,
    providerStatusUrl: submission?.providerStatusUrl ?? null,
  };
}

async function assertHiggsfieldUrl(raw: string): Promise<void> {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('status url');
  const host = url.hostname.toLowerCase();
  if (host !== 'api.higgsfield.ai' && !host.endsWith('.higgsfield.ai')) {
    throw new Error('status url host');
  }
}

export class HiggsfieldProvider implements AiGenerationProvider {
  readonly name = 'higgsfield' as const;
  private readonly env: HiggsfieldEnv;

  constructor(env: HiggsfieldEnv) {
    this.env = env;
  }

  async submit(request: GenerationRequest): Promise<ProviderSubmission> {
    const header = authHeader(this.env);
    if (!header) throw new Error('missing_credentials');
    const endpoint = endpointFor(this.env, request);
    if (!endpoint) throw new Error('endpoint_not_configured');
    if (request.toolType === 'image_to_video' && !request.sourceImageUrl?.startsWith('https://')) {
      throw new Error('source_not_public');
    }
    const body =
      request.toolType === 'ai_image'
        ? buildSoulBody(request)
        : {
            prompt: request.prompt ?? '',
            duration: request.durationSeconds ?? 5,
            ...(request.sourceImageUrl ? { image_url: request.sourceImageUrl } : {}),
          };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: header, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`provider_http_${response.status}`);
    const payload = (await response.json()) as {
      request_id?: string;
      status_url?: string;
      data?: { request_id?: string; status_url?: string };
    };
    const providerRequestId = payload.request_id ?? payload.data?.request_id;
    const providerStatusUrl = payload.status_url ?? payload.data?.status_url ?? null;
    if (!providerRequestId) throw new Error('provider_missing_request_id');
    return { providerRequestId, providerStatusUrl };
  }

  async resolve(request: GenerationRequest, submission: ProviderSubmission): Promise<ProviderResult> {
    const header = authHeader(this.env);
    if (!header) return failed('missing_credentials', submission);
    if (!submission.providerStatusUrl) return { outcome: 'ambiguous', detail: 'missing_status_url', ...submission };
    const deadline = Date.now() + (request.toolType === 'ai_image' ? 180_000 : 480_000);
    let latest: Record<string, unknown> = {};
    while (Date.now() < deadline) {
      try {
        await assertHiggsfieldUrl(submission.providerStatusUrl);
      } catch {
        return failed('status_url_rejected', submission);
      }
      const response = await fetch(submission.providerStatusUrl, { headers: { Authorization: header } });
      if (!response.ok) {
        await delay(2000);
        continue;
      }
      latest = (await response.json()) as Record<string, unknown>;
      const status = String(latest.status ?? '').toLowerCase();
      if (['completed', 'succeeded', 'success'].includes(status)) {
        const mediaUrl = findMediaUrl(latest);
        if (!mediaUrl) return { outcome: 'ambiguous', detail: 'missing_media_url', ...submission };
        try {
          const bytes = await fetchPublicHttps(mediaUrl);
          const mimeType = request.toolType === 'ai_image' ? 'image/png' : 'video/mp4';
          return {
            outcome: 'success',
            bytes,
            mimeType,
            providerRequestId: submission.providerRequestId,
            providerStatusUrl: submission.providerStatusUrl,
          };
        } catch {
          return { outcome: 'ambiguous', detail: 'media_fetch_blocked', ...submission };
        }
      }
      if (['nsfw', 'content_policy', 'moderation', 'safety'].includes(status)) {
        return {
          outcome: 'failed',
          kind: 'policy',
          detail: 'policy',
          providerRequestId: submission.providerRequestId,
          providerStatusUrl: submission.providerStatusUrl,
        };
      }
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
        return failed('technical', submission);
      }
      await delay(2000);
    }
    return { outcome: 'ambiguous', detail: 'poll_timeout', providerRequestId: submission.providerRequestId, providerStatusUrl: submission.providerStatusUrl };
  }
}

function findMediaUrl(payload: Record<string, unknown>): string | null {
  const images = payload.images;
  if (Array.isArray(images) && images[0] && typeof images[0] === 'object' && images[0] && 'url' in images[0]) {
    const url = (images[0] as { url?: unknown }).url;
    if (typeof url === 'string') return url;
  }
  const video = payload.video;
  if (video && typeof video === 'object' && 'url' in video && typeof video.url === 'string') return video.url;
  if (typeof payload.url === 'string') return payload.url;
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGenerationProvider(
  env: HiggsfieldEnv & { GENERATION_PROVIDER?: string },
): AiGenerationProvider {
  const mode = env.GENERATION_PROVIDER ?? (env.NODE_ENV === 'production' ? 'higgsfield' : 'fake');
  if (mode === 'fake') {
    if (env.NODE_ENV === 'production') {
      throw new Error('GENERATION_PROVIDER=fake is not allowed in production.');
    }
    return new FakeGenerationProvider();
  }
  return new HiggsfieldProvider(env);
}

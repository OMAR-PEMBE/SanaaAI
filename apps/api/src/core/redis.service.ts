import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { ApiError, securityLog } from '../common/http.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }

  async consume(bucket: string, id: string, limit: number, windowSeconds: number): Promise<void> {
    const key = `rl:${bucket}:${id}`;
    let hits: number;
    try {
      hits = await this.client.incr(key);
      if (hits === 1) await this.client.expire(key, windowSeconds);
    } catch (error) {
      securityLog('rate_limit_unavailable', {
        bucket,
        message: error instanceof Error ? error.message : 'error',
      });
      throw new ApiError(503, 'UNAVAILABLE', 'Try again in a moment.');
    }
    if (hits > limit) {
      const ttl = await this.client.ttl(key);
      const error = new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.');
      error.retryAfter = Math.max(ttl, 1);
      throw error;
    }
  }
}

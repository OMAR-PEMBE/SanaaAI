import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  toHealthData,
  type DependencyStatus,
  type HealthData,
  type ServiceName,
} from '@sanaaai/types';
import { Redis } from 'ioredis';
import { Pool } from 'pg';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(private readonly config: ConfigService) {
    this.pool = new Pool({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
      max: 2,
    });
  }

  async check(service: ServiceName): Promise<HealthData> {
    const [postgres, redis] = await Promise.all([
      this.pingPostgres(),
      this.pingRedis(),
    ]);
    return toHealthData(service, postgres, redis);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async pingPostgres(): Promise<DependencyStatus> {
    try {
      await this.pool.query('SELECT 1');
      return 'ok';
    } catch {
      // Connection errors can include the database URL. Do not log them.
      return 'error';
    }
  }

  private async pingRedis(): Promise<DependencyStatus> {
    const redis = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
    });

    try {
      await redis.connect();
      const result = await redis.ping();
      return result === 'PONG' ? 'ok' : 'error';
    } catch {
      return 'error';
    } finally {
      redis.disconnect();
    }
  }
}

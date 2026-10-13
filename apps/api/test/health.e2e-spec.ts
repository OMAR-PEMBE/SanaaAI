import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { HealthData } from '@sanaaai/types';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/core/prisma.service.js';
import { QueueService } from './../src/core/queue.service.js';
import { RedisService } from './../src/core/redis.service.js';
import { HealthService } from './../src/health/health.service.js';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;
  const check = vi.fn<() => Promise<HealthData>>();

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HealthService)
      .useValue({ check })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: async () => {}, onModuleDestroy: async () => {} })
      .overrideProvider(RedisService)
      .useValue({ onModuleInit: async () => {}, onModuleDestroy: async () => {}, consume: async () => {} })
      .overrideProvider(QueueService)
      .useValue({ onModuleDestroy: async () => {}, generations: { close: async () => {} } })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health returns the API payload', async () => {
    const data: HealthData = {
      status: 'ok',
      service: 'api',
      postgres: 'ok',
      redis: 'ok',
    };
    check.mockResolvedValue(data);

    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data });
  });

  it('GET /health returns 503 when the service reports degraded', async () => {
    const data: HealthData = {
      status: 'degraded',
      service: 'api',
      postgres: 'error',
      redis: 'ok',
    };
    check.mockResolvedValue(data);

    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ data });
  });
});

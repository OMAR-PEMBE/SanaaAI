import { HttpException } from '@nestjs/common';
import type { HealthData } from '@sanaaai/types';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

function controllerWith(data: HealthData): HealthController {
  const healthService = {
    check: async () => data,
  } as unknown as HealthService;
  return new HealthController(healthService);
}

describe('HealthController', () => {
  const healthy: HealthData = {
    status: 'ok',
    service: 'worker',
    postgres: 'ok',
    redis: 'ok',
  };

  it('returns the health payload when dependencies are up', async () => {
    await expect(controllerWith(healthy).getHealth()).resolves.toEqual({
      data: healthy,
    });
  });

  it('returns 503 when a dependency is down', async () => {
    const degraded: HealthData = {
      ...healthy,
      status: 'degraded',
      postgres: 'error',
    };
    const error = await controllerWith(degraded)
      .getHealth()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toEqual({ data: degraded });
  });
});

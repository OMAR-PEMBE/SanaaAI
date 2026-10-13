import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import type { HealthData } from '@sanaaai/types';
import { Public } from '../common/auth.guard.js';
import { HealthService } from './health.service.js';

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('health')
  async getHealth(): Promise<{ data: HealthData }> {
    const data = await this.healthService.check('api');
    if (data.status !== 'ok') {
      throw new HttpException({ data }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { data };
  }
}

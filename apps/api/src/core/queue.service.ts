import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly generations: Queue;

  constructor(config: ConfigService) {
    this.generations = new Queue('generations', {
      connection: {
        url: config.getOrThrow<string>('REDIS_URL'),
        maxRetriesPerRequest: null,
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.generations.close();
  }
}
